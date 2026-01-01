import express from "express";
import { twimlMessage } from "./twilio.js";
import { voiceResponse, voiceHangup } from "./voice.js";
import { receptionistReply, receptionistVoiceReply } from "./ai.js";
import { getMemory, addToMemory } from "./store.js";
import { getCallMemory, addCallMemory } from "./callStore.js";
import { getSlots, mergeSlots, clearSlots } from "./slotStore.js";
import { buildBookingISO } from "./timeParser.js";
import { getAuthUrl, setTokensFromCode } from "./calendar.js";

console.log("🔥 routes.js loaded");

const router = express.Router();

/* ================================
   TEST ROUTE (KEEP FOREVER)
================================ */
router.get("/test-route", (_req, res) => {
  res.json({ ok: true });
});

/* ================================
   GOOGLE CALENDAR OAUTH
================================ */

// Google Calendar connect (STEP 1)
router.get("/auth/google", (_req, res) => {
  try {
    const authUrl = getAuthUrl();
    console.log("🔗 Redirecting to Google OAuth:", authUrl);
    res.redirect(authUrl);
  } catch (error) {
    console.error("❌ Error generating auth URL:", error);
    res.status(500).send(`Error: ${error.message}. Check your environment variables.`);
  }
});

// Google callback (STEP 2)
router.get("/auth/google/callback", async (req, res) => {
  try {
    const code = req.query.code;
    const error = req.query.error;

    // Handle user denial
    if (error) {
      console.log("❌ User denied access:", error);
      return res.status(400).send("❌ Authorization denied. You cancelled the request.");
    }

    // Handle missing code
    if (!code) {
      console.log("❌ No authorization code received");
      return res.status(400).send("❌ No authorization code received. Please try again.");
    }

    console.log("✅ Received authorization code, exchanging for tokens...");
    await setTokensFromCode(code);
    
    console.log("✅ Google Calendar connected successfully!");
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Connected!</title>
          <style>
            body {
              font-family: system-ui, -apple-system, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .container {
              background: white;
              padding: 3rem;
              border-radius: 1rem;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              text-align: center;
            }
            h1 { color: #10b981; margin: 0 0 1rem 0; }
            p { color: #6b7280; margin: 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✅ Google Calendar Connected!</h1>
            <p>You can close this tab now.</p>
          </div>
        </body>
      </html>
    `);
  } catch (e) {
    console.error("❌ Google auth failed:", e);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Error</title>
          <style>
            body {
              font-family: system-ui, -apple-system, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #f87171 0%, #dc2626 100%);
            }
            .container {
              background: white;
              padding: 3rem;
              border-radius: 1rem;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              text-align: center;
              max-width: 500px;
            }
            h1 { color: #dc2626; margin: 0 0 1rem 0; }
            p { color: #6b7280; margin: 0 0 0.5rem 0; }
            code { 
              background: #f3f4f6; 
              padding: 0.25rem 0.5rem; 
              border-radius: 0.25rem;
              font-size: 0.875rem;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ Authentication Failed</h1>
            <p><strong>Error:</strong> <code>${e.message}</code></p>
            <p style="margin-top: 1rem;">Please check your Google Cloud Console settings and try again.</p>
          </div>
        </body>
      </html>
    `);
  }
});

/* ================================
   HEALTH (OPTIONAL)
================================ */
router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

/* ================================
   SMS WEBHOOK
================================ */
router.post("/webhook/sms", async (req, res) => {
  try {
    const from = req.body.From; // phone number = session key
    const body = (req.body.Body || "").trim();

    const memory = getMemory(from);
    addToMemory(from, `Customer: ${body}`);

    const ai = await receptionistReply({
      businessProfile: {
        businessName: "NightDesk Demo",
        hours: "Mon–Sat 10am–7pm",
        services: ["Haircut", "Beard Trim", "Haircut & Beard"],
      },
      customerMessage: body,
      memory,
    });

    // 🔑 merge extracted booking data
    const merged = mergeSlots(from, ai.booking || {});

    let reply = ai.reply;

    // Ask ONE missing thing only
    if (ai.intent === "book") {
      if (!merged.name) reply = "Great! What's your name?";
      else if (!merged.service) reply = "Which service would you like?";
      else if (!merged.dayText) reply = "What day works best?";
      else if (!merged.timeText) reply = `What time on ${merged.dayText}?`;
      else {
        // All info collected → confirmation
        reply = `Thanks ${merged.name}! You're booking a ${merged.service} on ${merged.dayText} at ${merged.timeText}. Reply YES to confirm.`;
      }
    }

    // Final confirmation
    if (/^yes$/i.test(body) && merged.dayText && merged.timeText) {
      clearSlots(from);
      reply = `✅ Your ${merged.service} is booked for ${merged.dayText} at ${merged.timeText}.`;
    }

    addToMemory(from, `AI: ${reply}`);

    res.type("text/xml").send(twimlMessage(reply));
  } catch (err) {
    console.error("SMS error:", err);
    res.type("text/xml").send(
      twimlMessage("Sorry, something went wrong. Please try again.")
    );
  }
});

/* ================================
   VOICE ENTRY
================================ */
router.post("/webhook/voice", (_req, res) => {
  res.type("text/xml").send(
    voiceResponse({
      sayText:
        "Hi, thanks for calling NightDesk. I can help book appointments or answer questions. How can I help?",
      gatherAction: "/api/webhook/voice/continue",
      gatherPrompt: "",
    })
  );
});

/* ================================
   VOICE CONTINUE
================================ */
router.post("/webhook/voice/continue", async (req, res) => {
  try {
    const callSid = req.body.CallSid;
    const speech = (req.body.SpeechResult || "").trim();

    if (!speech) {
      res.type("text/xml").send(
        voiceResponse({
          sayText: "Sorry, I didn't catch that. Could you repeat?",
          gatherAction: "/api/webhook/voice/continue",
          gatherPrompt: "",
        })
      );
      return;
    }

    if (/(bye|goodbye|thanks|thank you)/i.test(speech)) {
      res.type("text/xml").send(
        voiceHangup("Thanks for calling. Have a great day!")
      );
      return;
    }

    const memory = getCallMemory(callSid);
    addCallMemory(callSid, `Caller: ${speech}`);

    const ai = await receptionistVoiceReply({
      businessProfile: {
        businessName: "NightDesk Demo",
        hours: "Mon–Sat 10am–7pm",
        services: ["Haircut", "Beard Trim", "Haircut & Beard"],
      },
      customerMessage: speech,
      memory,
    });

    addCallMemory(callSid, `AI: ${ai.reply}`);

    res.type("text/xml").send(
      voiceResponse({
        sayText: ai.reply || "How else can I help?",
        gatherAction: "/api/webhook/voice/continue",
        gatherPrompt: "",
      })
    );
  } catch (err) {
    console.error("Voice webhook error:", err);
    res.type("text/xml").send(
      voiceHangup("Sorry, something went wrong. Please call again later.")
    );
  }
});

export default router;