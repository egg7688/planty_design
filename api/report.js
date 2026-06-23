const { createAcademicReport } = require("../lib/report-service");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "POST 요청만 지원합니다." });
  }

  try {
    const payload = await createAcademicReport({
      keyword: req.body?.keyword,
      reportTopic: req.body?.reportTopic,
      email: req.body?.email,
      authorization: req.headers.authorization
    });

    return res.status(200).json(payload);
  } catch (error) {
    console.error(error);
    return res.status(error.status || 500).json({
      message: error.message || "보고서를 생성하는 중 오류가 발생했습니다."
    });
  }
};
