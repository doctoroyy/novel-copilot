
import { getVoiceProvider } from './src/services/voiceService.js';
import 'dotenv/config';

// We need to test the REST API manually since we aren't sure of the signature
async function testGeminiTTS() {
    const apiKey = process.env.GEMINI_API_KEY; // Ensure this is set in .env or pass it
    if (!apiKey) {
        console.error("No API KEY");
        return;
    }

    const model = 'gemini-2.5-flash-preview-tts';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    console.log(`Testing ${model}...`);

    // Standard Gemini Request
    const body = {
        contents: [{
            parts: [{ text: "Please read the following text: \"Hello, this is a test of the Gemini TTS model.\"" }]
        }],
        generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: {
                        voiceName: "Kore"
                    }
                }
            }
        }
    };

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            console.error("Error:", res.status, await res.text());
            return;
        }

        const data = await res.json();
        console.log("Response Keys:", Object.keys(data));
        // keys likely: candidates, usageMetadata
        if (data.candidates && data.candidates[0].content) {
             console.log("Content Parts:", JSON.stringify(data.candidates[0].content.parts, null, 2));
             // Check for inlineData
        } else {
            console.log("Full Data:", JSON.stringify(data, null, 2));
        }

    } catch (e) {
        console.error(e);
    }
}

// Also test if there is a speech specific endpoint?
// https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateSpeech ? (Similar to verify_models?)

testGeminiTTS();
