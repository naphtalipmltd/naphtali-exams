// =====================================================================
// Portal settings — the ONLY file you need to edit in the website.
// Both Supabase values are on: Supabase dashboard > Project Settings > API.
// The "anon / publishable" key is designed to be public; it is safe here.
// NEVER put the "service_role" / secret key in this file.
// =====================================================================
window.PORTAL_CONFIG = {
  SUPABASE_URL: "https://vkkqflleefodebxpuwft.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_-fs5kkTwYsLN3RQJe-fXhQ_CWR3SK6S",

  ACADEMY_NAME: "Naphtali PM Group Academy",
  LOGO_URL: "https://lh3.googleusercontent.com/d/1BW1wGguKB1izoLvBrG5zPDsI1ps3QAAo",
  SUPPORT_EMAIL: "naphtalipmltd@gmail.com",

  // Set to true only after you have switched on Google sign-in in Supabase
  // (see the deployment manual, Optional extras).
  GOOGLE_SIGN_IN: false,

  // Result emails are sent by the Google mailer (deployment manual, Step 7).
  // Paste the mailer's Web app URL (ends in /exec) between the quotes.
  RESULT_EMAIL_URL: "PASTE-MAILER-WEB-APP-URL-HERE",
  RESULT_EMAILS: true
};
