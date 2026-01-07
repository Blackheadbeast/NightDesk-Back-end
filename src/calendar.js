import { google } from 'googleapis';
import config from './config.js';

class CalendarService {
  constructor() {
    this.calendar = null;
    this.initialized = false;
  }

 async initialize() {
  if (this.initialized) return;

  let credentials;

  // Try to use full JSON first (more reliable)
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    } catch (error) {
      console.error('Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON:', error);
      throw new Error('Invalid service account JSON');
    }
  } else {
    // Fallback to separate credentials
    credentials = {
      client_email: config.googleCalendar.clientEmail,
      private_key: config.googleCalendar.privateKey?.replace(/\\n/g, '\n'),
    };
  }

  const auth = new google.auth.GoogleAuth({
    credentials: credentials,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });

  this.calendar = google.calendar({ version: 'v3', auth });
  this.initialized = true;
}
  /**
   * Check if a time slot is available
   * @param {Date} startTime - Start of requested slot
   * @param {Date} endTime - End of requested slot
   * @returns {Promise<boolean>} - True if available, false if booked
   */
  async isSlotAvailable(startTime, endTime) {
    await this.initialize();

    // Add 5-minute buffer to prevent back-to-back conflicts
    const bufferMs = 5 * 60 * 1000;
    const searchStart = new Date(startTime.getTime() - bufferMs);
    const searchEnd = new Date(endTime.getTime() + bufferMs);

    try {
      const response = await this.calendar.events.list({
        calendarId: config.googleCalendar.calendarId,
        timeMin: searchStart.toISOString(),
        timeMax: searchEnd.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });

      const events = response.data.items || [];
      return events.length === 0;
    } catch (error) {
      console.error('Error checking availability:', error);
      throw new Error('Failed to check calendar availability');
    }
  }

  /**
   * Book an appointment with race condition protection
   * @param {Date} startTime - Start of appointment
   * @param {Date} endTime - End of appointment
   * @param {Object} callerInfo - Caller details {name, phone, email, notes}
   * @returns {Promise<Object>} - Booking result
   */
  async bookAppointment(startTime, endTime, callerInfo) {
    await this.initialize();

    // Double-check availability right before booking
    const isAvailable = await this.isSlotAvailable(startTime, endTime);
    
    if (!isAvailable) {
      return {
        success: false,
        reason: 'SLOT_TAKEN',
        message: 'This time slot was just booked by another caller',
      };
    }

    // Create the event
    const event = {
      summary: `Appointment - ${callerInfo.name}`,
      description: `
Phone: ${callerInfo.phone}
Email: ${callerInfo.email || 'Not provided'}
Notes: ${callerInfo.notes || 'None'}
Booked via: NightDesk AI
      `.trim(),
      start: {
        dateTime: startTime.toISOString(),
        timeZone: config.googleCalendar.timeZone || 'America/Denver',
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone: config.googleCalendar.timeZone || 'America/Denver',
      },
      attendees: callerInfo.email ? [{ email: callerInfo.email }] : [],
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 }, // 1 day before
          { method: 'popup', minutes: 60 }, // 1 hour before
        ],
      },
    };

    try {
      const response = await this.calendar.events.insert({
        calendarId: config.googleCalendar.calendarId,
        resource: event,
        sendUpdates: 'all', // Send email confirmation if attendee added
      });

      return {
        success: true,
        eventId: response.data.id,
        eventLink: response.data.htmlLink,
        message: 'Appointment successfully booked',
      };
    } catch (error) {
      console.error('Error booking appointment:', error);
      
      // Check if it's a conflict error (race condition)
      if (error.code === 409 || error.message.includes('conflict')) {
        return {
          success: false,
          reason: 'RACE_CONDITION',
          message: 'This time slot was just booked by another caller',
        };
      }

      throw new Error('Failed to book appointment');
    }
  }

  /**
   * Find available slots on a specific date
   * @param {Date} date - The date to search
   * @param {number} durationMinutes - Appointment duration
   * @param {number} maxResults - Maximum number of slots to return
   * @returns {Promise<Array>} - Array of available time slots
   */
  async findAvailableSlots(date, durationMinutes, maxResults = 3) {
    await this.initialize();

    const businessHours = {
      start: config.businessHours?.start || 9, // 9 AM
      end: config.businessHours?.end || 17, // 5 PM
    };

    // Set up day boundaries
    const dayStart = new Date(date);
    dayStart.setHours(businessHours.start, 0, 0, 0);
    
    const dayEnd = new Date(date);
    dayEnd.setHours(businessHours.end, 0, 0, 0);

    // Get all events for the day
    const response = await this.calendar.events.list({
      calendarId: config.googleCalendar.calendarId,
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const bookedEvents = response.data.items || [];
    const availableSlots = [];
    
    // Check every 30-minute interval
    let currentTime = new Date(dayStart);
    const intervalMinutes = 30;
    const durationMs = durationMinutes * 60 * 1000;

    while (currentTime < dayEnd && availableSlots.length < maxResults) {
      const slotEnd = new Date(currentTime.getTime() + durationMs);
      
      // Check if slot fits within business hours
      if (slotEnd > dayEnd) {
        break;
      }

      // Check if slot overlaps with any booked event
      const hasConflict = bookedEvents.some(event => {
        const eventStart = new Date(event.start.dateTime || event.start.date);
        const eventEnd = new Date(event.end.dateTime || event.end.date);
        
        return (
          (currentTime >= eventStart && currentTime < eventEnd) ||
          (slotEnd > eventStart && slotEnd <= eventEnd) ||
          (currentTime <= eventStart && slotEnd >= eventEnd)
        );
      });

      if (!hasConflict) {
        availableSlots.push({
          start: new Date(currentTime),
          end: new Date(slotEnd),
        });
      }

      // Move to next interval
      currentTime = new Date(currentTime.getTime() + intervalMinutes * 60 * 1000);
    }

    return availableSlots;
  }

  /**
   * Find next available days with time slots
   * @param {Date} startDate - Date to start searching from
   * @param {number} durationMinutes - Appointment duration
   * @param {number} maxDays - Maximum number of days to return
   * @param {number} slotsPerDay - Number of slots to show per day
   * @returns {Promise<Array>} - Array of days with available slots
   */
  async findNextAvailableDays(startDate, durationMinutes, maxDays = 3, slotsPerDay = 2) {
    const availableDays = [];
    let currentDate = new Date(startDate);
    let daysChecked = 0;
    const maxDaysToCheck = 14; // Don't search more than 2 weeks ahead

    while (availableDays.length < maxDays && daysChecked < maxDaysToCheck) {
      // Skip weekends if configured
      const dayOfWeek = currentDate.getDay();
      if (config.businessHours?.skipWeekends && (dayOfWeek === 0 || dayOfWeek === 6)) {
        currentDate.setDate(currentDate.getDate() + 1);
        daysChecked++;
        continue;
      }

      const slots = await this.findAvailableSlots(currentDate, durationMinutes, slotsPerDay);
      
      if (slots.length > 0) {
        availableDays.push({
          date: new Date(currentDate),
          slots: slots,
        });
      }

      currentDate.setDate(currentDate.getDate() + 1);
      daysChecked++;
    }

    return availableDays;
  }

  /**
   * Format time for voice response
   * @param {Date} dateTime - DateTime to format
   * @returns {string} - Formatted string like "2:00 PM"
   */
  formatTimeForVoice(dateTime) {
    return dateTime.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  /**
   * Format date for voice response
   * @param {Date} date - Date to format
   * @returns {string} - Formatted string like "Wednesday, March 15th"
   */
  formatDateForVoice(date) {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }
}

// Export a singleton instance
export default new CalendarService();