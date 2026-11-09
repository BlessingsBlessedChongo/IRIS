/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#0A1E33',
          mid: '#1B3A5C',
          deep: '#061422',
        },
        amber: {
          DEFAULT: '#E8A020',
          soft: '#F5C468',
        },
        rip: '#EF4444',
        object: '#F59E0B',
        edge: '#38BDF8',
        ink: {
          DEFAULT: '#F4F7FA',
          muted: '#7EA9C9',
          faint: '#4C6E8C',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      backdropBlur: {
        glass: '18px',
      },
      boxShadow: {
        glass: '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 24px 48px -24px rgba(0,0,0,0.6)',
      },
      keyframes: {
        'ring-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(239,68,68,0.55)' },
          '50%': { boxShadow: '0 0 0 6px rgba(239,68,68,0)' },
        },
      },
      animation: {
        'ring-pulse': 'ring-pulse 1.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
