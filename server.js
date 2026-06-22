const path = require("path");
const express = require("express");
const { createAcademicReport, createPremiumSession } = require("./lib/report-service");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/login", async (req, res) => {
  try {
    const session = await createPremiumSession({
      email: req.body?.email,
      accessCode: req.body?.accessCode
    });

    res.json(session);
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({
      message: error.message || "유료 로그인 중 오류가 발생했습니다."
    });
  }
});

app.post("/api/report", async (req, res) => {
  try {
    const payload = await createAcademicReport({
      keyword: req.body?.keyword,
      email: req.body?.email,
      authorization: req.headers.authorization
    });

    res.json(payload);
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({
      message: error.message || "보고서를 생성하는 중 오류가 발생했습니다."
    });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Academic report mailer running at http://localhost:${PORT}`);
  });
}

module.exports = app;
