/* =======================
   ENV SETUP
======================= */
import dotenv from "dotenv";
dotenv.config();

/* =======================
   IMPORTS
======================= */
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

/* =======================
   PATH SETUP
======================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/* =======================
   APP SETUP
======================= */
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

/* =======================
   🔥 GROQ AI CORE (USED EVERYWHERE)
======================= */
async function callGroq(prompt, maxTokens = 400) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
    }),
  });

  const data = await res.json();
  return data?.choices?.[0]?.message?.content || "";
}

/* =======================
   🧼 INTERVIEW OUTPUT CLEANER (NEW)
======================= */
function extractOnlyQuestion(text) {
  if (!text) return "";

  // Prefer quoted question
  const quoted = text.match(/["“](.+?\?)["”]/);
  if (quoted) return quoted[1].trim();

  // Else first sentence ending with ?
  const qm = text.match(/[^?]*\?/);
  if (qm) return qm[0].trim();

  // Fallback
  return text.split("\n")[0].trim();
}

/* =======================
   🧠 INTERVIEW SYSTEM
======================= */
const interviewSessions = {};
const stages = ["basic", "role", "technical", "resume", "behavioral", "salary"];

function getStageQuestion(stage, jobRole, resume) {
  const prompts = {
    basic: `Ask ONE HR interview question for ${jobRole}. Output ONLY the question.`,
    role: `Ask ONE role-specific interview question for ${jobRole}. Output ONLY the question.`,
    technical: `Ask ONE technical interview question for ${jobRole}. Output ONLY the question.`,
    resume: `Resume:\n${resume}\nAsk ONE interview question. Output ONLY the question.`,
    behavioral: `Ask ONE behavioral interview question. Output ONLY the question.`,
    salary: `Ask ONE professional salary or availability question. Output ONLY the question.`,
  };
  return prompts[stage];
}

function nextStage(stage) {
  const idx = stages.indexOf(stage);
  return idx < stages.length - 1 ? stages[idx + 1] : null;
}

/* =======================
   INTERVIEW ROUTES
======================= */
app.post("/interview/start", async (req, res) => {
  const { jobRole, resumeText } = req.body;
  if (!jobRole || !resumeText) {
    return res.status(400).json({ error: "Missing jobRole or resumeText" });
  }

  const sessionId = uuidv4();
  const stage = "basic";

  const raw = await callGroq(getStageQuestion(stage, jobRole, resumeText));
  const question = extractOnlyQuestion(raw);

  interviewSessions[sessionId] = {
    jobRole,
    resumeText,
    stage,
    history: [],
    lastQuestion: question,
  };

  res.json({
    sessionId,
    question,
    stage,
    questionCount: 1,
    maxQuestions: stages.length,
  });
});

app.post("/interview/answer", async (req, res) => {
  const { sessionId, answer } = req.body;
  const s = interviewSessions[sessionId];
  if (!s || !answer) {
    return res.status(400).json({ error: "Invalid session or answer" });
  }

  s.history.push({ question: s.lastQuestion, answer });

  if (s.stage === "salary") {
    const feedback = await callGroq(
      `Provide professional interview feedback with:
- Strengths
- Weaknesses
- Communication
- Overall assessment

Transcript:
${JSON.stringify(s.history, null, 2)}`,
      700
    );

    delete interviewSessions[sessionId];
    return res.json({ feedback });
  }

  s.stage = nextStage(s.stage);
  const raw = await callGroq(
    getStageQuestion(s.stage, s.jobRole, s.resumeText)
  );
  s.lastQuestion = extractOnlyQuestion(raw);

  res.json({
    question: s.lastQuestion,
    stage: s.stage,
    questionCount: s.history.length + 1,
  });
});

app.post("/interview/clarify", async (req, res) => {
  const { sessionId } = req.body;
  const s = interviewSessions[sessionId];
  if (!s || !s.lastQuestion) {
    return res.status(400).json({ error: "Invalid session" });
  }

  const raw = await callGroq(
    `Rephrase this interview question clearly. Output ONLY the question:\n${s.lastQuestion}`
  );

  s.lastQuestion = extractOnlyQuestion(raw);
  res.json({ question: s.lastQuestion });
});

app.post("/interview/finish", async (req, res) => {
  const { sessionId } = req.body;
  const s = interviewSessions[sessionId];
  if (!s) return res.status(400).json({ error: "Invalid session" });

  const feedback = await callGroq(
    `Give detailed interview feedback with clear sections.
Transcript:
${JSON.stringify(s.history, null, 2)}`,
    700
  );

  delete interviewSessions[sessionId];
  res.json({ feedback });
});

/* =======================
   📄 RESUME AI (UNCHANGED)
======================= */
app.post("/suggest", async (req, res) => {
  const { role } = req.body;
  if (!role) return res.status(400).json({ error: "Role required" });

  const prompt = `
Return ONLY valid JSON.
{
  "skills": ["6 skills"],
  "summary": "5-line summary",
  "description": "4-line experience description"
}
Role: ${role}
`;

  const raw = await callGroq(prompt, 400);
  const clean = raw.replace(/```json|```/g, "").trim();

  try {
    const json = JSON.parse(
      clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1)
    );
    res.json(json);
  } catch {
    console.error("❌ Resume AI raw output:", raw);
    res.status(500).json({ error: "Invalid AI JSON" });
  }
});

/* =======================
   🎯 CAREER AI (UNCHANGED)
======================= */
app.post("/career-ai", async (req, res) => {
  try {
    const { type, input, skills } = req.body;

    let prompt = "";

    if (type === "skills-to-career") {
      prompt = `
Return ONLY valid JSON.
{
  "best_fit_role": "string",
  "why": "string",
  "responsibilities": ["string"],
  "next_skills": ["string"],
  "growth_path": "string",
  "average_salary": "string",
  "industries": ["string"],
  "job_type": "string",
  "entry_experience": "string",
  "courses": ["string"],
  "top_companies": ["string"]
}
Skills: ${skills.join(", ")}
`;
    } else {
      prompt = `
Return ONLY valid JSON.
{
  "role": "string",
  "overview": "string",
  "required_degree": "string",
  "required_skills": ["string"],
  "soft_skills": ["string"],
  "career_progression": "string",
  "average_salary": "string",
  "industries": ["string"],
  "certifications": ["string"],
  "top_companies": ["string"]
}
Role: ${input}
`;
    }

    const raw = await callGroq(prompt, 500);
    const clean = raw.replace(/```json|```/g, "").trim();
    const jsonText = clean.slice(
      clean.indexOf("{"),
      clean.lastIndexOf("}") + 1
    );

    res.json(JSON.parse(jsonText));
  } catch (err) {
    console.error("❌ Career AI raw error:", err);
    res.status(500).json({ error: "Invalid AI JSON" });
  }
});

/* =======================
   HEALTH & ROOT
======================= */
app.get("/health", (_, res) => res.json({ status: "OK" }));
app.get("/", (_, res) => res.sendFile(join(__dirname, "index.html")));

/* =======================
   START SERVER
======================= */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () =>
  console.log(`✅ Server running at http://localhost:${PORT}`)
);
