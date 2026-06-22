/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        mono: ['ui-monospace', '"SFMono-Regular"', 'Consolas', '"Liberation Mono"', 'monospace'],
      },
      colors: {
        // Sentinel ink scale (near-black, slight blue)
        ink: {
          950: '#080a10',
          900: '#0a0c12',
          850: '#0f121a',
          800: '#151926',
          750: '#1a1f2e',
          700: '#1f2535',
          600: '#2a3142',
          500: '#3a4456',
        },
        line: '#232a39',
        muted: '#8a93a6',
        faint: '#5a6377',
        // Single electric accent
        accent: {
          DEFAULT: '#4d7cfe',
          hover: '#618cff',
          soft: 'rgba(77,124,254,0.12)',
        },
        // Risk semantics (refined)
        risk: {
          low: '#2fbf71',
          needs: '#e0a93b',
          suspicious: '#e0783b',
          scam: '#f0544f',
          inconclusive: '#8a93a6',
        },
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 12px 40px -12px rgba(0,0,0,0.6)',
        glow: '0 0 0 1px rgba(77,124,254,0.35), 0 8px 30px -8px rgba(77,124,254,0.45)',
      },
      backgroundImage: {
        'grid-faint':
          'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.4s ease-out both',
      },
    },
  },
  plugins: [],
};
