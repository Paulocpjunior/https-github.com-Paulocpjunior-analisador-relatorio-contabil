import { GoogleGenAI } from "@google/genai";

async function run() {
    const ai = new GoogleGenAI({ apiKey: "AIzaSyDHkzM_CVIn6T28JkVpd-86_RwKKaeqYRY" });
    try {
        const response15 = await ai.models.generateContent({
            model: 'gemini-1.5-flash',
            contents: 'hello'
        }).catch(e => e.message);
        console.log("gemini-1.5-flash test:", response15.text ? "SUCCESS" : response15);

        const response20 = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: 'hello'
        }).catch(e => e.message);
        console.log("gemini-2.0-flash test:", response20.text ? "SUCCESS" : response20);

        const response25 = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: 'hello'
        }).catch(e => e.message);
        console.log("gemini-2.5-flash test:", response25.text ? "SUCCESS" : response25);

    } catch (e) {
        console.error("Failed", e);
    }
}
run();
