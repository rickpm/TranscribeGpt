require("dotenv").config();
const express = require("express");
const multer = require("multer");
const AWS = require("aws-sdk");
const path = require("path");
const axios = require("axios");
const pm2 = require("pm2");
const fs = require("fs");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ limit: "10mb", extended: true }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
// Set up multer for file uploads
const storage = multer.memoryStorage();
// Set up multer for file uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, "./"); // Save the file in the root of the application
    },
    filename: function (req, file, cb) {
      cb(null, file.originalname); // Use the original filename
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB upload limit
});


// Configure AWS SDK
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
  s3: {
    maxFileSize: 20 * 1024 * 1024, // 10MB upload limit
  },
});

const s3 = new AWS.S3();
const bucketName = process.env.S3_BUCKET_NAME;

// Route for handling file upload
app.post("/upload", upload.single("file"), (req, res) => {
  const file = req.file;

  if (!file) {
    res.status(400).send("No file uploaded");
    return;
  }

  const params = {
    Bucket: bucketName,
    Key: "audio/" + file.originalname,
    Body: fs.createReadStream(file.path), // Use a readable stream of the file path
  };

  s3.upload(params, (err, data) => {
    // Delete the file after upload is complete
    fs.unlink(file.path, (err) => {
      if (err) {
        console.error("Error deleting file:", err);
      }
    });

    if (err) {
      console.error("Error uploading file:", err);
      res.status(500).send("Error uploading file");
    } else {
      console.log("File uploaded successfully. Size:", file.size);
      res.send("File uploaded successfully");
    }
  });
});




// Route for checking transcript availability and getting transcript URL
app.get("/transcripts/:filename", (req, res) => {
  const fileName = req.params.filename;
  const transcriptFileName = fileName.replace(".wav", ".txt");
  const transcriptKey = "transcripts/" + transcriptFileName;

  const params = {
    Bucket: bucketName,
    Key: transcriptKey,
  };

  s3.getSignedUrl("getObject", params, (err, url) => {
    if (err) {
      console.error("Error getting signed URL:", err);
      res.status(500).send("Error getting signed URL");
    } else {
      console.log("Transcript URL:", url);
      res.send(url);
    }
  });
});

app.post("/chat", async (req, res) => {
  const prompt = req.body.prompt;

  const apiUrl = "https://api.openai.com/v1/chat/completions";
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.API_KEY}`,
  };

  const data = {
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: prompt },
    ],
    max_tokens: 100, // Adjust this as per your requirements
    model: "gpt-3.5-turbo", // Specify the model ID or name here
  };

  try {
    const response = await axios.post(apiUrl, data, { headers });
    res.json({ response: response.data.choices[0].message.content });
    //console.log('Response:', response.data.choices[0].message.content);
  } catch (error) {
    console.error("OpenAI API Error:", error.response.data);
    res.status(500).json({ error: "An error occurred" });
  }
});

// Serve the HTML file
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Start the server
const port = 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// PM2 Logging
pm2