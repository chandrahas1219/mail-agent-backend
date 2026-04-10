import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import fetch from "node-fetch";
import { google } from "googleapis";

dotenv.config();

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  "https://mail-agent-backend.onrender.com/auth/google/callback"
);

const app = express();

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

let savedTokens = null;

// ✅ Root
app.get("/", (req, res) => {
  res.send("Backend is running 🚀");
});

// ✅ Start server
app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});

// ✅ Google Login
app.get("/auth/google", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/spreadsheets.readonly",
      "https://www.googleapis.com/auth/drive.readonly"
    ],
  });

  res.redirect(url);
});

// ✅ Callback FIXED
app.get("/auth/google/callback", async (req, res) => {
  const code = req.query.code;

  try {
    const { tokens } = await oauth2Client.getToken(code);

    savedTokens = tokens; // ✅ store first
    oauth2Client.setCredentials(tokens); // ✅ then set

    res.redirect("https://mail-agent-frontend.netlify.app");

  } catch (error) {
    console.error(error);
    res.send("Login failed ❌");
  }
});

// ✅ Chat (fixed prompt)
app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;

  try {
    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "mistral-small",
        messages: [
          {
            role: "system",
            content: `
You are an AI mail assistant.

Extract:
- name (if mentioned)
- email (if mentioned)
- subject (generate if not given)
- message (full email body)

Rules:
- Always return ONLY valid JSON
- Keep subject clear and professional
- Generate meaningful subject from context
- Email should be polite and structured
- Default length: 80–200 words

Return format:
{
  "name": "",
  "email": "",
  "subject": "",
  "message": ""
}
`
          },
          {
            role: "user",
            content: userMessage
          }
        ],
      }),
    });

    const data = await response.json();
    res.send(data.choices[0].message.content);

  } catch (error) {
    console.error(error);
    res.send("Error with AI ❌");
  }
});

// ✅ Send Mail (FULLY FIXED)
app.post("/send-mail", async (req, res) => {
  const userMessage = req.body.message;

  if (!savedTokens) {
    return res.send("Login first ❌");
  }

  oauth2Client.setCredentials(savedTokens);

  try {
    // 🧠 AI Call
    const aiRes = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "mistral-small",
        messages: [
          {
            role: "system",
            content: `
You are an AI mail assistant.

Extract:
- name
- email (if present)
- subject
- message

Return ONLY JSON:
{
  "name": "",
  "email": "",
  "subject": "",
  "message": ""
}
`
          },
          {
            role: "user",
            content: userMessage,
          },
        ],
      }),
    });

    const aiData = await aiRes.json();
    const aiText = aiData.choices[0].message.content;

    const cleanText = aiText.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleanText);
    } catch {
      console.log("AI RAW:", aiText);
      return res.send("AI parsing failed ❌");
    }

    let { name, email, subject, message } = parsed;

    if (!subject) subject = "Quick update";

    // 📊 Sheet lookup if email missing
    if (!email) {
      const sheets = google.sheets({ version: "v4", auth: oauth2Client });

      const sheetRes = await sheets.spreadsheets.values.get({
        spreadsheetId: "1Sp-MuTFYaI0e9liyBJROG1ZZiNN5udPb0_KDuMkiooE",
        range: "Sheet1!A:B",
      });

      const rows = sheetRes.data.values;

      for (let row of rows) {
        if (row[0].toLowerCase() === name.toLowerCase()) {
          email = row[1];
          break;
        }
      }

      if (!email) return res.send("Name not found ❌");
    }

    // ✉️ Send Mail
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const senderName = "AI Mail Agent";

    const mail = [
      `From: "${senderName}" <me>`,
      `To: ${email}`,
      `Subject: ${subject}`,
      "",
      message,
    ].join("\n");

    const encoded = Buffer.from(mail)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

    await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encoded,
      },
    });

    res.send(`Email sent to ${email} ✅`);

  } catch (error) {
    console.error(error);
    res.send("Something went wrong ❌");
  }
});

// ✅ Logout
app.get("/logout", (req, res) => {
  savedTokens = null;
  res.send("Logged out ✅");
});