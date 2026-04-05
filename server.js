import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";

dotenv.config();

import { google } from "googleapis";

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  ""https://YOUR-APP.onrender.com/auth/google/callback""
);


const app = express();
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

app.get("/", (req, res) => {
  res.send("Backend is running 🚀");
});

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});

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

//const userTokens = {};
let savedTokens = null;

app.get("/auth/google/callback", async (req, res) => {
  const code = req.query.code;

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(savedTokens);

    //savedTokens = tokens; // ✅ store globally (temporary)
// const userId = Math.random().toString(36).substring(7);

// userTokens[userId] = tokens;

// // store userId in cookie
// res.cookie("uid", userId, {
//   httpOnly: true,
//   sameSite: "lax"
// });
savedTokens = tokens;

res.send("Login successful ✅ You can close this tab");

  } catch (error) {
    console.error(error);
    res.send("Login failed ❌");
  }
});

app.get("/send-test-mail", async (req, res) => {
//   const uid = req.cookies.uid;
// const tokens = userTokens[uid];

// if (!tokens) {
if (!savedTokens){
  return res.send("Login first ❌");
}

oauth2Client.setCredentials(savedTokens);

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const message = [
    "To: chandrahaskrishnapuram36@gmail.com",
    "Subject: Test Mail",
    "",
    "Hello from your AI Mail Agent 🚀"
  ].join("\n");

  const encodedMessage = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  try {
    await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encodedMessage,
      },
    });

    res.send("Email sent successfully ✅");
  } catch (error) {
    console.error(error);
    res.send("Failed to send email ❌");
  }
});

app.get("/get-email", async (req, res) => {
  const nameToFind = req.query.name;

//   const uid = req.cookies.uid;
// const tokens = userTokens[uid];

// if (!tokens) {
if (!savedTokens){
  return res.send("Login first ❌");
}

oauth2Client.setCredentials(savedTokens);

  const sheets = google.sheets({ version: "v4", auth: oauth2Client });

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: "1Sp-MuTFYaI0e9liyBJROG1ZZiNN5udPb0_KDuMkiooE",
      range: "Sheet1!A:B",
    });

    const rows = response.data.values;

    for (let row of rows) {
      const name = row[0];
      const email = row[1];

      if (name.toLowerCase() === nameToFind.toLowerCase()) {
        return res.send(`Email found: ${email} ✅`);
      }
    }

    res.send("Name not found ❌");
  } catch (error) {
    console.error(error);
    res.send("Error reading sheet ❌");
  }
});

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
            content: "Extract name, email (if present), and message. Return JSON like {name, email, message}"
          },
          {
            role: "user",
            content: userMessage
          }
        ],
      }),
    });

    const data = await response.json();
    const aiText = data.choices[0].message.content;

    res.send(aiText);
  } catch (error) {
    console.error(error);
    res.send("Error with AI ❌");
  }
});

app.post("/send-mail", async (req, res) => {
  const userMessage = req.body.message;

// const uid = req.cookies.uid;
// const tokens = userTokens[uid];

// if (!tokens) {
if (!savedTokens){
return res.send("Login first ❌");
}

oauth2Client.setCredentials(savedTokens);
  try {
    // 🧠 STEP 1: Call Mistral
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
            content:
              "Extract name, email (if present), and message. Return JSON only like {name, email, message}",
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
      return res.send("AI response parsing failed ❌");
    }

    let { name, email, message } = parsed;

    // 📧 STEP 2: Decide email
    if (!email) {
      // Fetch from Google Sheets
      const sheets = google.sheets({ version: "v4", auth: oauth2Client });

      const sheetRes = await sheets.spreadsheets.values.get({
        spreadsheetId: "1Sp-MuTFYaI0e9liyBJROG1ZZiNN5udPb0_KDuMkiooE",
        range: "Sheet1!A:B",
      });

      const rows = sheetRes.data.values;

      let found = false;

      for (let row of rows) {
        if (row[0].toLowerCase() === name.toLowerCase()) {
          email = row[1];
          found = true;
          break;
        }
      }

      if (!found) {
        return res.send("Name not found in sheet ❌");
      }
    }

    // ✉️ STEP 3: Send Gmail
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const mail = [
      `To: ${email}`,
      "Subject: AI Generated Mail",
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

app.get("/logout", (req, res) => {
  // const uid = req.cookies.uid;

  // if (uid) {
  //   delete userTokens[uid]; // remove this user's tokens
  // }

  // res.clearCookie("uid"); // remove cookie from browser
savedTokens = null;
  res.send("Logged out ✅");
});