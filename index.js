import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import dotenv from "dotenv";
import http from "http";
import fs from "fs";
import path from "path";
import axios from "axios";
import ImageKit from "@imagekit/nodejs";
import Groq from "groq-sdk";

dotenv.config();

const PORT = Number(process.env.PORT || 5001);
const allowedOrigins = (
  process.env.CORS_ORIGINS ||
  process.env.ELECTRON_HOST ||
  "http://localhost:5173"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const apiBaseUrl = new URL(
  process.env.NEXT_API_HOST || "http://localhost:3000/api/",
);

if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
  throw new Error("PORT must be a valid TCP port number.");
}

if (!apiBaseUrl.pathname.endsWith("/")) {
  apiBaseUrl.pathname += "/";
}

const nextApiUrl = (pathname) => new URL(pathname, apiBaseUrl).toString();

const app = express();
const server = http.createServer(app);

const imagekit = new ImageKit({
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
});

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },
});

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  }),
);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

const uploadDirectory = path.join(process.cwd(), "temp_upload");

if (!fs.existsSync(uploadDirectory)) {
  fs.mkdirSync(uploadDirectory, {
    recursive: true,
  });
}

const recordedChunks = new Map();

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("video-chunks", async (data) => {
    try {
      const { filename, chunks } = data;
      console.log("Chunks created ✅");
      if (!filename || !chunks) return;

      if (!recordedChunks.has(filename)) {
        recordedChunks.set(filename, []);
      }

      const chunksArray = recordedChunks.get(filename);

      chunksArray.push(chunks);

      const videoBlob = new Blob(chunksArray, {
        type: "video/webm",
      });

      const buffer = Buffer.from(await videoBlob.arrayBuffer());

      const filePath = path.join(uploadDirectory, filename);

      fs.writeFileSync(filePath, buffer);
    } catch (error) {
      console.error("Error receiving video chunk:", error);
    }
  });

  socket.on("process-video", async (data) => {
    try {
      const { filename, userId } = data;

      if (!filename || !userId) return;

      const filePath = path.join(uploadDirectory, filename);

      if (!fs.existsSync(filePath)) {
        console.error("Video file not found:", filePath);
        return;
      }

      recordedChunks.delete(filename);

      const processingResponse = await axios.post(
        nextApiUrl(`recording/${userId}/processing`),
        {
          filename,
        },
      );

      if (processingResponse.data.status !== 200) {
        console.error("Failed to create processing record");
        return;
      }

      const plan = processingResponse.data.plan;

      const uploadResponse = await imagekit.files.upload({
        file: fs.createReadStream(filePath),
        fileName: filename,
      });
      console.log("upload res", uploadResponse);
      let transcript = null;
      let title = null;
      let summary = null;

      if (plan === "PRO") {
        const transcription = await groq.audio.transcriptions.create({
          file: fs.createReadStream(filePath),
          model: "whisper-large-v3-turbo",
          response_format: "verbose_json",
        });

        transcript = transcription.text?.trim();

        if (!transcript) {
          console.error("Transcript is empty");
          return;
        }

        const completion = await groq.chat.completions.create({
          model: "openai/gpt-oss-120b",
          response_format: {
            type: "json_object",
          },
          temperature: 0,
          messages: [
            {
              role: "system",
              content: `
You are a video transcript analysis assistant.

Generate:
- A short meaningful title.
- A clear and useful summary.

Use the provided transcript.

Do not ask for the transcript.

Return only valid JSON in exactly this format:

{
  "title": "short meaningful title",
  "summary": "clear useful summary"
}

Do not return markdown.
Do not return explanations.
Do not return text outside the JSON object.
`,
            },
            {
              role: "user",
              content: `Video transcript:\n${transcript}`,
            },
          ],
        });

        const aiContent = completion.choices[0]?.message?.content;

        if (!aiContent) {
          console.error("Failed to generate AI content");
          return;
        }

        const generatedContent = JSON.parse(aiContent);

        title = generatedContent.title;
        summary = generatedContent.summary;
        const transcribeResponse = await axios.post(
          nextApiUrl(`recording/${userId}/transcribe`),
          {
            filename,
            transcript,
            title,
            summary,
          },
        );

        if (transcribeResponse.data.status !== 200) {
          console.error("Failed to save transcript and summary");
          return;
        }
      }
      //complete response :=
      const completeResponse = await axios.post(
        nextApiUrl(`recording/${userId}/complete`),
        {
          filename,
          videoUrl: uploadResponse.url,
          fileId: uploadResponse.fileId,
        },
      );

      if (completeResponse.data.status !== 200) {
        console.error("Failed to complete recording");
        return;
      }

      fs.unlink(filePath, (error) => {
        if (error) {
          console.error("Failed to delete temporary video:", error);
        }
      });
    } catch (error) {
      console.error("Error processing video:", error);
    }
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
});
