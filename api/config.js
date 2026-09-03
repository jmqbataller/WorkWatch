export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || '';
  res.status(200).json({
    supabaseUrl: url,
    supabasePublishableKey: key,
    configured: Boolean(url && key),
    appName: 'JM WorkLog'
  });
}
