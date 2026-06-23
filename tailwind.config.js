/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Williams Diversified brand palette
        navy: {
          50:  '#fdf8e7',
          100: '#F5DFA3',
          600: '#D4AF37',
          700: '#2B2B2B',
          800: '#0A0A0A',
          900: '#000000',
        },
        gold: {
          primary:  '#D4AF37',
          deep:     '#A67C00',
          highlight:'#F5DFA3',
          molten:   '#C89B2B',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
