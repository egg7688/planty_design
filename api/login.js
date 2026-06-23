const { createPremiumSession } = require("../lib/report-service");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "POST 요청만 지원합니다." });
  }

  try {
    const session = await createPremiumSession({
      email: req.body?.email,
      accessCode: req.body?.accessCode,
      dbpiaLoginConfirmed: req.body?.dbpiaLoginConfirmed === true
    });

    return res.status(200).json(session);
  } catch (error) {
    console.error(error);
    return res.status(error.status || 500).json({
      message: error.message || "DBpia 기관인증 확인 중 오류가 발생했습니다."
    });
  }
};
