/**
 * UnlockHub Translate Worker
 * Route target: https://unlockhubtranslateinfo.sashabro1997.workers.dev
 *
 * Secrets:
 *   AI_STUDIO_API_KEY  (Google AI Studio API key)
 */

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

const GEMMA_TRANSLATE_MODEL = 'gemma-3-4b-it';
const GEMMA_GUIDE_MODELS = ['gemma-3-27b-it', 'gemma-3-12b-it', 'gemma-3-4b-it'];
const AI_STUDIO_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const ok = (data, status = 200) => new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
});

const bad = (error, status = 400) => ok({ error }, status);

function cleanText(v, maxLen = 12000) {
    const s = String(v || '').trim();
    return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function langLabel(code) {
    return String(code || '').toLowerCase().startsWith('uk') ? 'Ukrainian' : 'English';
}

function safeJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

async function callGemmaModel(model, apiKey, prompt) {
    const url = `${AI_STUDIO_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.2,
                topP: 0.9,
                topK: 40,
                maxOutputTokens: 1024,
            },
        }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = payload?.error?.message || `Model request failed: ${res.status}`;
        throw new Error(msg);
    }
    const text = payload?.candidates?.[0]?.content?.parts?.map(p => p?.text || '').join('\n').trim() || '';
    if (!text) throw new Error('Empty model output');
    return text;
}

function buildTranslatePrompt(input) {
    const target = langLabel(input.target_lang);
    const sourceText = cleanText(input.text, 12000);
    const contentType = cleanText(input.content_type || 'generic', 64);
    const gameName = cleanText(input.game_name || '', 180);
    const achievementName = cleanText(input.achievement_name || '', 180);

    return [
        'You are a precise game localization assistant.',
        `Translate the text to ${target}.`,
        'Rules:',
        '- Preserve original meaning and facts.',
        '- Do not add any new information.',
        '- Keep game names, achievement names and proper nouns unchanged when appropriate.',
        '- Keep formatting readable; if source has short lines, keep short lines.',
        '- Return only translated text, with no comments.',
        `Context type: ${contentType}`,
        gameName ? `Game: ${gameName}` : '',
        achievementName ? `Achievement: ${achievementName}` : '',
        'Source text:',
        sourceText,
    ].filter(Boolean).join('\n');
}

function buildGuidePrompt(input) {
    const target = langLabel(input.target_lang);
    const gameName = cleanText(input.game_name || '', 180);
    const achievementName = cleanText(input.achievement_name || '', 220);
    const achievementDescription = cleanText(input.achievement_description || '', 800);

    return [
        `You are a careful achievement guide assistant for the game "${gameName || 'Unknown game'}".`,
        `Write the answer in ${target}.`,
        'Task: explain how to unlock the specified achievement using only reliable inferences from the provided name/description.',
        'Hard constraints:',
        '- Do NOT invent exact steps, items, locations or numbers if unknown.',
        '- If details are uncertain, explicitly say what is uncertain.',
        '- Prefer concise bullet-like steps in plain text.',
        '- Mention prerequisites only if they are very likely.',
        '- Include a short "Confidence" line at the end: High / Medium / Low.',
        `Achievement name: ${achievementName || 'Unknown'}`,
        `Achievement description: ${achievementDescription || 'No description provided.'}`,
    ].join('\n');
}

async function runWithFallback(models, apiKey, prompt) {
    const errors = [];
    for (const model of models) {
        try {
            const text = await callGemmaModel(model, apiKey, prompt);
            return { text, model };
        } catch (e) {
            errors.push({ model, error: e.message || 'unknown' });
        }
    }
    const summary = errors.map(e => `${e.model}: ${e.error}`).join(' | ');
    throw new Error(`All fallback models failed. ${summary}`);
}

async function handleTranslate(req, apiKey) {
    const body = await req.json().catch(() => ({}));
    const text = cleanText(body.text, 12000);
    if (!text) return bad('text is required');
    const target_lang = cleanText(body.target_lang || 'uk', 10);
    const prompt = buildTranslatePrompt({
        text,
        target_lang,
        content_type: body.content_type || 'generic',
        game_name: body.game_name || '',
        achievement_name: body.achievement_name || '',
    });
    const out = await callGemmaModel(GEMMA_TRANSLATE_MODEL, apiKey, prompt);
    return ok({
        translated_text: out,
        model: GEMMA_TRANSLATE_MODEL,
        target_lang,
    });
}

async function handleGuide(req, apiKey) {
    const body = await req.json().catch(() => ({}));
    const game_name = cleanText(body.game_name || '', 180);
    const achievement_name = cleanText(body.achievement_name || '', 220);
    const achievement_description = cleanText(body.achievement_description || '', 1200);
    if (!achievement_name) return bad('achievement_name is required');
    const target_lang = cleanText(body.target_lang || 'uk', 10);
    const prompt = buildGuidePrompt({
        game_name,
        achievement_name,
        achievement_description,
        target_lang,
    });
    const out = await runWithFallback(GEMMA_GUIDE_MODELS, apiKey, prompt);
    return ok({
        guide_text: out.text,
        model: out.model,
        target_lang,
    });
}

addEventListener('fetch', event => event.respondWith(handle(event.request)));

async function handle(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const path = new URL(req.url).pathname;
    if (req.method === 'GET' && path === '/') return ok({ ok: true, service: 'unlockhub-translate-worker' });

    const apiKey = typeof AI_STUDIO_API_KEY === 'string' ? AI_STUDIO_API_KEY : '';
    if (!apiKey) return bad('AI_STUDIO_API_KEY is not configured', 500);

    try {
        if (req.method === 'POST' && path === '/api/translate') return await handleTranslate(req, apiKey);
        if (req.method === 'POST' && path === '/api/achievement-guide') return await handleGuide(req, apiKey);
        return bad('Not found', 404);
    } catch (e) {
        return ok({
            error: 'AI request failed',
            detail: String(e?.message || 'unknown error'),
        }, 500);
    }
}
