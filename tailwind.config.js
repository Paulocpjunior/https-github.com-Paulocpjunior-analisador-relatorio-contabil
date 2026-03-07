/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                primary: '#0f172a',
                secondary: '#334155',
                accent: '#2563eb',
            }
        },
    },
    plugins: [],
}
