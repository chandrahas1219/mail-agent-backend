import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import fetch from "node-fetch";
import { google } from "googleapis";

dotenv.config();

const app = express();

app.use(cors({
  origin: "https://mail-agent-frontend.netlify.app",
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  "https://mail-agent-backend.onrender.com/auth/google/callback"
);

// ✅ MULTI USER STORAGE
const userTokens = {};

// ✅ SERVER START
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

app.get("/", (req, res) => {
  res.send("Backend is running 🚀");
});

// 🔐 LOGIN
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

// 🔐 CALLBACK
app.get("/auth/google/callback", async (req, res) => {
  const code = req.query.code;

  try {
    const { tokens } = await oauth2Client.getToken(code);

    const uid = Math.random().toString(36).substring(7);
    userTokens[uid] = tokens;

res.cookie("uid", uid, {
  httpOnly: true,
  sameSite: "none",
  secure: true
});

    res.redirect("https://mail-agent-frontend.netlify.app");

  } catch (error) {
    console.error(error);
    res.send("Login failed ❌");
  }
});

// 📊 GET EMAIL
app.get("/get-email", async (req, res) => {
  const nameToFind = req.query.name;

  const uid = req.cookies.uid;
  const tokens = userTokens[uid];

  if (!tokens) {
    return res.send("Login first ❌");
  }

  oauth2Client.setCredentials(tokens);

  const sheets = google.sheets({ version: "v4", auth: oauth2Client });

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: "1Sp-MuTFYaI0e9liyBJROG1ZZiNN5udPb0_KDuMkiooE",
      range: "Sheet1!A:B",
    });

    const rows = response.data.values;

    for (let row of rows) {
      if (
        row[0] &&
        nameToFind &&
        row[0].toLowerCase() === nameToFind.toLowerCase()
      ) {
        return res.send(`Email found: ${row[1]} ✅`);
      }
    }

    res.send("Name not found ❌");

  } catch (error) {
    console.error(error);
    res.send("Error reading sheet ❌");
  }
});

// 📧 SEND MAIL
app.post("/send-mail", async (req, res) => {
  const userMessage = req.body.message;

  const uid = req.cookies.uid;
  const tokens = userTokens[uid];

  if (!tokens) {
    return res.send("Login first ❌");
  }

  oauth2Client.setCredentials(tokens);

  // ✅ GET SENDER NAME
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const profile = await gmail.users.getProfile({ userId: "me" });
  const senderEmail = profile.data.emailAddress;

  let senderName = senderEmail.split("@")[0];
  senderName =
    senderName.charAt(0).toUpperCase() + senderName.slice(1);

  try {
    // 🤖 AI CALL
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
You are a professional email assistant.

Return STRICT JSON:
{
  "name": "",
  "email": "",
  "subject": "",
  "message": ""
}

Rules:
- Subject must be natural and professional
- Message must:
  - Start with greeting
  - Be well structured
  - Expand vague inputs
  - Be 80-150 words (or follow user instruction)

- End with:
Thanks,
${senderName}

- NEVER return placeholders
- NEVER return 1-line message
- Output ONLY JSON
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

    // 📊 SHEETS LOOKUP
    if (!email) {
      const sheets = google.sheets({ version: "v4", auth: oauth2Client });

      function extractSheetId(input) {
        if (!input) return null;
        const match = input.match(/\/d\/([a-zA-Z0-9-_]+)/);
        return match ? match[1] : input;
      }

      const userInput = req.body.sheetId || req.body.sheetLink;
      const sheetId =
        extractSheetId(userInput) ||
        "1Sp-MuTFYaI0e9liyBJROG1ZZiNN5udPb0_KDuMkiooE";

      const sheetRes = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: "Sheet1!A:B",
      });

      const rows = sheetRes.data.values;

      for (let row of rows) {
        if (row[0].toLowerCase() === name.toLowerCase()) {
          email = row[1];
          break;
        }
      }

      if (!email) {
        return res.send("Name not found in sheet ❌");
      }
    }

    // ✉️ SEND MAIL
    const mail = [
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
      requestBody: { raw: encoded },
    });

    res.send(`Email sent to ${email} ✅`);

  } catch (error) {
    console.error(error);
    res.send("Something went wrong ❌");
  }
});

// 🚪 LOGOUT
app.get("/logout", (req, res) => {
  const uid = req.cookies.uid;

  if (uid) {
    delete userTokens[uid];
  }

  res.clearCookie("uid");
  res.send("Logged out ✅");
});