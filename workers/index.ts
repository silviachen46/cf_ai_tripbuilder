/// <reference types="@cloudflare/workers-types" />

import Groq from 'groq-sdk';

export interface Env {
  DB: D1Database;
  SESSION_DO: DurableObjectNamespace;
  GROQ_API_KEY: string;
}

type UiBlock = {
  time: string;
  title: string;
  place_name?: string;
  tags: string[];
  est_duration?: number;
};

type DayPlan = {
  day: number;
  blocks: UiBlock[];
};


const j = (data: any, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });


const withTimeout = <T>(p: Promise<T>, ms = 20_000) =>
  Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error('AI timeout')), ms)),
  ]);


async function handleGenerateItinerary(req: Request, env: Env) {
  const reqId = crypto.randomUUID();
  console.log(`[gen][${reqId}] hit`);

  let body: {
    days?: number;
    nights?: number;
    companions?: string;
    style_tags?: string[];
    city?: string;
    budget?: string;
  };

  try {
    body = (await req.json()) as any;
  } catch (e: any) {
    console.error(`[gen][${reqId}] req.json() failed:`, e?.message);
    return j({ ok: false, error: 'invalid JSON body' }, 400);
  }

  const days = Number(body.days ?? 0);
  const nights = Number(body.nights ?? Math.max(days - 1, 0));
  const companions = String(body.companions ?? 'friends');
  const style_tags = Array.isArray(body.style_tags) ? body.style_tags : [];
  const city = String(body.city ?? '');
  const budget = String(body.budget ?? '');

  if (!days || days < 1) {
    console.warn(`[gen][${reqId}] invalid days:`, days);
    return j({ ok: false, error: '`days` must be >= 1' }, 400);
  }


  const userId = 'demo-user';
  let prefs: any;
  try {
    const row = await env.DB.prepare(
      'SELECT * FROM user_prefs WHERE user_id = ?'
    ).bind(userId).first();

    prefs =
      row || {
        wake_start: '07:30',
        wake_end: '22:30',
        pace: 'relaxed',
        budget: 'mid',
        like_tags: JSON.stringify(['coffee', 'art']),
        avoid_tags: JSON.stringify([]),
      };
    console.log(`[gen][${reqId}] prefs loaded:`, JSON.stringify(prefs));
  } catch (e: any) {
    console.error(`[gen][${reqId}] D1 select user_prefs failed:`, e?.message);

    prefs = {
      wake_start: '07:30',
      wake_end: '22:30',
      pace: 'relaxed',
      budget: 'mid',
      like_tags: JSON.stringify(['coffee', 'art']),
      avoid_tags: JSON.stringify([]),
    };
  }

  const systemPrompt = `You are a trip itinerary composer. Create detailed travel itineraries with time blocks.
Granularity: 30-90min per activity. Cluster activities by area to minimize travel time. Include buffer time.
Return strictly valid JSON matching the schema.`;

  const userPrompt = `Create a ${days}-day itinerary for ${city}.
Preferences: ${JSON.stringify(prefs)}
Companions: ${companions}
Budget: ${budget || 'Not specified'}
Style tags: ${JSON.stringify(style_tags)}
Wake hours: ${prefs.wake_start} to ${prefs.wake_end}

${budget ? `IMPORTANT: Consider the budget constraint of ${budget} when suggesting activities, restaurants, and accommodations. Choose cost-effective options that fit within this budget.` : ''}

Generate an array of day plans. Each day should have multiple time blocks with activities.`;

  try {
    console.log(`[gen][${reqId}] calling Groq API with structured output`);
    const groq = new Groq({ apiKey: env.GROQ_API_KEY });
    
    const response = await withTimeout(
      groq.chat.completions.create({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "itinerary_plan",
            schema: {
              type: "object",
              properties: {
                days: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      day: { type: "number" },
                      blocks: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            time: { type: "string" },
                            title: { type: "string" },
                            place_name: { type: "string" },
                            tags: { 
                              type: "array",
                              items: { type: "string" }
                            },
                            est_duration: { type: "number" }
                          },
                          required: ["time", "title", "tags"]
                        }
                      }
                    },
                    required: ["day", "blocks"]
                  }
                }
              },
              required: ["days"]
            }
          }
        },
        temperature: 0.7,
        max_tokens: 2000
      }),
      20_000
    );

    console.log(`[gen][${reqId}] Groq API done`);

    const content = response.choices[0]?.message?.content || "{}";
    const result = JSON.parse(content);
    const plan: DayPlan[] = result.days || [];

    console.log(`[gen][${reqId}] plan days:`, plan.length);
    return j({ ok: true, plan }, 200);
  } catch (e: any) {
    console.error(`[gen][${reqId}] Groq API failed:`, e?.message);
    return j({ ok: false, error: `AI error: ${e?.message || 'unknown'}` }, 502);
  }
}

async function handleSaveItinerary(req: Request, env: Env) {
  const { trip, plan } = (await req.json()) as {
    trip: {
      title?: string;
      days: number;
      nights: number;
      companions: string;
      budget?: string;
      style_tags?: string[];
      city?: string;
      country?: string;
    };
    plan: DayPlan[];
  };

  const now = new Date().toISOString();
  const tripId = crypto.randomUUID();


  const statements: D1PreparedStatement[] = [];

  statements.push(
    env.DB.prepare(
      `INSERT INTO trips (id,user_id,title,days,nights,companions,budget,style_tags,city,country,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      tripId,
      'demo-user',
      trip.title || `${trip.city || 'Trip'}`,
      Number(trip.days),
      Number(trip.nights),
      trip.companions,
      trip.budget || '',
      JSON.stringify(trip.style_tags || []),
      trip.city || '',
      trip.country || '',
      now,
      now
    )
  );

  for (const day of plan) {
    const dayId = crypto.randomUUID();
    statements.push(
      env.DB.prepare(
        `INSERT INTO trip_days (id,trip_id,day_index,notes) VALUES (?,?,?,?)`
      ).bind(dayId, tripId, Number(day.day), '')
    );

    for (const b of day.blocks || []) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO blocks (id,trip_day_id,time,title,place_name,tags,est_duration,llm_source)
           VALUES (?,?,?,?,?,?,?,?)`
        ).bind(
          crypto.randomUUID(),
          dayId,
          String(b.time),
          String(b.title),
          b.place_name ? String(b.place_name) : '',
          JSON.stringify(b.tags || []),
          b.est_duration ? Number(b.est_duration) : 60,
          'groq:llama-3.3-70b'
        )
      );
    }
  }


  await env.DB.batch(statements);

  return new Response(JSON.stringify({ ok: true, trip_id: tripId }), {
    headers: { 'Content-Type': 'application/json' },
  });
}


async function handleLoadItinerary(req: Request, env: Env) {
  const url = new URL(req.url);
  const tripId = url.searchParams.get('trip_id');
  if (!tripId) return new Response('missing trip_id', { status: 400 });

  const trip = await env.DB.prepare(`SELECT * FROM trips WHERE id=?`)
    .bind(tripId)
    .first();

  const daysRes = await env.DB.prepare(
    `SELECT * FROM trip_days WHERE trip_id=? ORDER BY day_index ASC`
  )
    .bind(tripId)
    .all();

  const dayRows = (daysRes.results ?? []) as any[];

  const plan: DayPlan[] = [];
  for (const d of dayRows) {
    const bs = await env.DB.prepare(
      `SELECT * FROM blocks WHERE trip_day_id=? ORDER BY time ASC`
    )
      .bind(d.id)
      .all();

    const rows = (bs.results ?? []) as any[];
    plan.push({
      day: Number(d.day_index),
      blocks: rows.map((r) => ({
        time: String(r.time),
        title: String(r.title),
        place_name: r.place_name ? String(r.place_name) : '',
        tags: r.tags ? JSON.parse(String(r.tags)) : [],
        est_duration: r.est_duration ? Number(r.est_duration) : 60,
      })),
    });
  }

  return new Response(JSON.stringify({ trip, plan }), {
    headers: { 'Content-Type': 'application/json' },
  });
}


async function handleGetTrips(_req: Request, env: Env) {
  const userId = 'demo-user';
  const rows = await env.DB.prepare(
    `SELECT id, title, city, country, created_at
     FROM trips WHERE user_id=? ORDER BY datetime(created_at) DESC LIMIT 50`
  ).bind(userId).all();

  return new Response(JSON.stringify({ trips: rows.results || [] }), {
    headers: { 'Content-Type': 'application/json' },
  });
}


async function handleGetChatMessages(_req: Request, env: Env) {
  const userId = 'demo-user';
  const rows = await env.DB.prepare(
    `SELECT role, content, created_at
     FROM chat_messages WHERE user_id=? ORDER BY datetime(created_at) DESC LIMIT 10`
  ).bind(userId).all();


  const messages = (rows.results || []).reverse().map((r: any) => ({
    role: r.role,
    content: r.content,
    created_at: r.created_at
  }));

  return new Response(JSON.stringify({ messages }), {
    headers: { 'Content-Type': 'application/json' },
  });
}


async function handleDeleteTrip(req: Request, env: Env) {
  const { trip_id } = (await req.json()) as { trip_id: string };
  
  if (!trip_id) {
    return j({ ok: false, error: 'trip_id is required' }, 400);
  }

  const userId = 'demo-user';

  try {

    const statements: D1PreparedStatement[] = [];


    const daysRes = await env.DB.prepare(
      `SELECT id FROM trip_days WHERE trip_id=?`
    ).bind(trip_id).all();

    const dayIds = (daysRes.results || []).map((d: any) => d.id);


    for (const dayId of dayIds) {
      statements.push(
        env.DB.prepare(`DELETE FROM blocks WHERE trip_day_id=?`).bind(dayId)
      );
    }


    statements.push(
      env.DB.prepare(`DELETE FROM trip_days WHERE trip_id=?`).bind(trip_id)
    );


    statements.push(
      env.DB.prepare(`DELETE FROM trip_diary WHERE trip_id=?`).bind(trip_id)
    );


    statements.push(
      env.DB.prepare(`DELETE FROM trips WHERE id=? AND user_id=?`).bind(trip_id, userId)
    );

    await env.DB.batch(statements);

    return j({ ok: true, message: 'Trip deleted successfully' }, 200);
  } catch (e: any) {
    console.error('[delete] Failed to delete trip:', e?.message);
    return j({ ok: false, error: `Failed to delete trip: ${e?.message || 'unknown'}` }, 500);
  }
}

async function handleNextDestination(req: Request, env: Env) {
  const userId = 'demo-user';
  const { user_message } = (await req.json().catch(() => ({ user_message: '' }))) as { user_message: string };

  const recentMessages = await env.DB.prepare(
    `SELECT role, content FROM chat_messages WHERE user_id=? ORDER BY datetime(created_at) DESC LIMIT 10`
  ).bind(userId).all();

  const messageHistory = (recentMessages.results || []).reverse().map((m: any) => ({
    role: m.role,
    content: m.content
  }));

  const trips = await env.DB.prepare(
    `SELECT id FROM trips WHERE user_id=? ORDER BY datetime(created_at) DESC LIMIT 30`
  ).bind(userId).all();

  const tripIds = (trips.results || []).map((r: any) => r.id);
  let tagCount: Record<string, number> = {};
  let timeCount: Record<string, number> = {}; 

  for (const tid of tripIds) {
    const days = await env.DB.prepare(
      `SELECT id FROM trip_days WHERE trip_id=?`
    ).bind(tid).all();
    for (const d of (days.results || []) as any[]) {
      const bs = await env.DB.prepare(
        `SELECT time, tags FROM blocks WHERE trip_day_id=?`
      ).bind(d.id).all();
      for (const b of (bs.results || []) as any[]) {

        const tags = b.tags ? JSON.parse(String(b.tags)) : [];
        for (const t of tags) {
          const key = String(t).toLowerCase();
          tagCount[key] = (tagCount[key] || 0) + 1;
        }

        const time = (b.time || '') as string;
        const hour = Number(time.split(':')[0] || 0);
        const bucket = hour < 11 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
        timeCount[bucket] = (timeCount[bucket] || 0) + 1;
      }
    }
  }

  const topTags = Object.entries(tagCount).sort((a,b)=>b[1]-a[1]).slice(0,6).map(x=>x[0]);
  const timePattern = Object.entries(timeCount).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(', ');

  const systemPrompt = `You are a travel recommender. Based on user's travel history and chat context, recommend 3 destinations.

IMPORTANT: Format your response as a structured Markdown list with:
- **City Name, Country**: Brief description (1 sentence)
  + Activity 1 (concise)
  + Activity 2 (concise) 
  + Activity 3 (concise)

Be specific about activities and locations. Use proper Markdown formatting with **bold** for city names and + for activities.`;

  const userPrompt = `User's current request: "${user_message}"

Travel history analysis:
- Top preferred tags: ${JSON.stringify(topTags)}
- Time preferences: ${timePattern || 'unknown'}

Recent chat context:
${messageHistory.length > 0 ? messageHistory.map(m => `${m.role}: ${m.content}`).join('\n') : 'No previous messages'}

Recommend 3 destinations that match their interests and current request.`;

  try {
    const groq = new Groq({ apiKey: env.GROQ_API_KEY });
    
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.8,
      max_tokens: 1000
    });

    const text = response.choices[0]?.message?.content || '';
    

    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO chat_messages (id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), userId, 'user', user_message, now),
      env.DB.prepare(
        `INSERT INTO chat_messages (id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), userId, 'assistant', text, now)
    ]);

    return new Response(JSON.stringify({ text }), {
      headers: { 'Content-Type':'application/json' }
    });
  } catch (e: any) {
    console.error('[reco] Groq API failed:', e?.message);
    return j({ ok: false, error: `AI error: ${e?.message || 'unknown'}` }, 502);
  }
}


async function handleDiarySummarize(req: Request, env: Env) {
  const { trip_id, day_index, user_sentences } = (await req.json()) as {
    trip_id: string;
    day_index: number;
    user_sentences: string;
  };

  const dayRow = await env.DB.prepare(
    `SELECT * FROM trip_days WHERE trip_id=? AND day_index=?`
  )
    .bind(trip_id, Number(day_index))
    .first();

  if (!dayRow) {
    return new Response('day not found', { status: 404 });
  }

  const blocksRes = await env.DB.prepare(
    `SELECT * FROM blocks WHERE trip_day_id=? ORDER BY time ASC`
  )
    .bind((dayRow as any).id)
    .all();

  const blocks = (blocksRes.results ?? []) as any[];

  const systemPrompt = `Turn user's sentences and today's travel blocks into a first-person mini journal (120-180 words).
Write naturally and engagingly, capturing the experience and emotions.`;

  const userPrompt = `User's thoughts: ${user_sentences}

Today's activities:
${blocks.map((b) => `- ${b.time}: ${b.title} at ${b.place_name || 'location'}`).join('\n')}

Write a brief first-person travel journal entry.`;

  try {
    const groq = new Groq({ apiKey: env.GROQ_API_KEY });
    
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 400
    });

    const journal = response.choices[0]?.message?.content || '';

    await env.DB.prepare(
      `INSERT INTO trip_diary (id,trip_id,day_index,user_sentences,llm_journal,created_at)
       VALUES (?,?,?,?,?,?)`
    )
      .bind(
        crypto.randomUUID(),
        trip_id,
        Number(day_index),
        user_sentences,
        journal,
        new Date().toISOString()
      )
      .run();

    return new Response(JSON.stringify({ llm_journal: journal }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('[diary] Groq API failed:', e?.message);
    return j({ ok: false, error: `AI error: ${e?.message || 'unknown'}` }, 502);
  }
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    const pathname = url.pathname;
    const method = req.method;

    try {
      console.log('[fetch]', method, pathname);


      if (pathname === '/api/ping' && method === 'GET') {
        return new Response('pong', { status: 200 });
      }


      if (pathname === '/api/itinerary/generate' && method === 'POST') {
        return await handleGenerateItinerary(req, env);
      }

      if (pathname === '/api/itinerary/save' && method === 'POST') {
        return await handleSaveItinerary(req, env);
      }

      if (pathname === '/api/itinerary/load' && method === 'GET') {
        return await handleLoadItinerary(req, env);
      }

      if (pathname === '/api/trips' && method === 'GET') {
        return await handleGetTrips(req, env);
      }

      if (pathname === '/api/chat/messages' && method === 'GET') {
        return await handleGetChatMessages(req, env);
      }

      if (pathname === '/api/trips/delete' && method === 'POST') {
        return await handleDeleteTrip(req, env);
      }

      if (pathname === '/api/reco/next-destination' && method === 'POST') {
        return await handleNextDestination(req, env);
      }

      if (pathname === '/api/diary/summarize' && method === 'POST') {
        return await handleDiarySummarize(req, env);
      }





      console.warn('[fetch] no matching route, returning 404');
      return new Response('Not Found', { status: 404 });
    } catch (e: any) {
      console.error('[fetch] uncaught error:', e?.stack || e?.message || e);
      return new Response(
        JSON.stringify({ ok: false, error: e?.message || 'internal error' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  },
};


export class SessionDO {
  state: DurableObjectState;
  env: Env;
  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }
  async fetch(_req: Request) {
    return new Response('OK');
  }
}
