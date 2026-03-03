// netlify/functions/news.mjs
// Runs on Netlify servers — no CORS issues, full Anthropic API access
// Frontend calls it at: /api/news

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 200, headers: CORS });
  }

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured in Netlify environment variables' }),
      { status: 500, headers: CORS }
    );
  }

  const SYSTEM = `You are a war news JSON generator. Use web_search to find today's latest news. After searching, output ONLY a raw JSON array. No markdown, no backticks, no explanation. Start with [ end with ].`;

  const USER = `Search for the very latest breaking news RIGHT NOW on:
1. US-Israel vs Iran war 2026 (Operation Epic Fury, latest developments)
2. Russia-Ukraine war latest
3. Israel-Gaza war latest
4. Sudan civil war latest
5. Myanmar civil war latest
6. International reactions and country stances on all these wars

Return ONLY a JSON array of 18-22 items. Each item:
{"filter":"iran"|"ukraine"|"gaza"|"sudan"|"myanmar"|"stances","breaking":true|false,"headline":"headline under 100 chars","body":"2-3 factual sentences","source":"Source name","time":"e.g. Mar 3, 2026"}

ONLY the JSON array. Nothing before [. Nothing after ].`;

  try {
    const messages = [{ role: 'user', content: USER }];
    let finalText = '';
    let turns = 0;

    while (turns < 10) {
      turns++;
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          system: SYSTEM,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages,
        }),
      });

      if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0,200)}`);

      const data = await res.json();
      const content = data.content || [];

      content.filter(b => b.type === 'text').forEach(b => { finalText += b.text; });

      if (data.stop_reason === 'end_turn') break;

      if (data.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content });
        const results = content
          .filter(b => b.type === 'tool_use')
          .map(b => ({
            type: 'tool_result',
            tool_use_id: b.id,
            content: typeof b.content === 'string' ? b.content : JSON.stringify(b.input || {}),
          }));
        if (results.length) { messages.push({ role: 'user', content: results }); continue; }
      }
      break;
    }

    if (!finalText.trim()) throw new Error('No text after ' + turns + ' turns');

    const si = finalText.indexOf('[');
    const ei = finalText.lastIndexOf(']');
    if (si === -1 || ei <= si) throw new Error('No JSON array found');

    const items = JSON.parse(finalText.slice(si, ei + 1));
    if (!Array.isArray(items) || !items.length) throw new Error('Empty array');

    return new Response(
      JSON.stringify({ items, fetchedAt: new Date().toISOString() }),
      { status: 200, headers: { ...CORS, 'Cache-Control': 'public, s-maxage=180' } }
    );

  } catch (err) {
    console.error('[news]', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
};

export const config = { path: '/api/news' };
