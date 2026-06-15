/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Federal-inspired palette
        navy: {
          50: '#eef2f7',
          100: '#dbe4ee',
          600: '#1b3a6b',
          700: '#142d54',
          800: '#0f2440',
          900: '#0a1a2f',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
