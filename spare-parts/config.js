// ============================================================
// Supabase connection config
// ============================================================
// The anon key below is DESIGNED to be public — it's meant to sit in
// browser-visible code like this. It cannot read/write anything that
// Row Level Security (RLS) policies in the database don't explicitly
// allow. Never put the "service_role" key here or anywhere client-side —
// that one bypasses RLS entirely and must stay server-side only (we don't
// use it anywhere in this project).
window.LMS_SUPABASE_URL = 'https://lpnqgaenkawdfycuiigy.supabase.co';
window.LMS_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxwbnFnYWVua2F3ZGZ5Y3VpaWd5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3NTczNzIsImV4cCI6MjEwNDMzMzM3Mn0.EDJdjqILfnR-sFEWVqmcnRnGfEwut_id_DhUNWPd5Is';
