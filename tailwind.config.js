/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './packages/**/*.{html,ts,tsx,js,jsx}',
    './src/**/*.{html,ts,tsx,js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        // "The Private Cinema" Palette - Dark Only
        bg: '#0E0B09', // Warm black (cinema darkness)
        surface: {
          DEFAULT: '#1A1512', // Primary velvet surface
          2: '#261E19', // Secondary elevated surface
          3: '#362B24', // Tertiary hover/active surface
        },
        text: {
          DEFAULT: '#F3E9DC', // Warm cream
          muted: '#A89B8C', // Oyster / aged parchment
          dark: '#675C51', // Deep hairline muted
        },
        accent: {
          DEFAULT: '#FF9F1C', // Projector amber (<10% screen budget)
          glow: 'rgba(255, 159, 28, 0.22)',
        },
        'accent-2': {
          DEFAULT: '#E4572E', // Marquee red
          glow: 'rgba(228, 87, 46, 0.25)',
        },
        live: {
          DEFAULT: '#2EC4B6', // Cathode teal presence beacon
          glow: 'rgba(46, 196, 182, 0.32)',
        },
        danger: {
          DEFAULT: '#D62839', // Warning / ticket invalid red
          glow: 'rgba(214, 40, 57, 0.32)',
        },
        border: {
          subtle: 'rgba(243, 233, 220, 0.08)',
          brass: 'rgba(243, 233, 220, 0.16)',
          'brass-bright': 'rgba(255, 159, 28, 0.45)',
          marquee: 'rgba(228, 87, 46, 0.4)',
        },
      },
      fontFamily: {
        display: ['Fraunces', 'Bricolage Grotesque', 'Georgia', 'serif'],
        ui: ['DM Sans', 'Instrument Sans', 'system-ui', 'sans-serif'],
        sans: ['DM Sans', 'Instrument Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      letterSpacing: {
        'tight-display': '-0.035em',
        'tight-ui': '-0.01em',
        'wide-code': '0.06em',
      },
      lineHeight: {
        chat: '1.625', // Generous line-height for chat messages
      },
      borderRadius: {
        sm: '2px', // Architectural, tactile
        DEFAULT: '4px',
        md: '4px',
        lg: '6px',
        ticket: '8px',
        pill: '9999px',
      },
      boxShadow: {
        'velvet-inset': 'inset 0 2px 4px rgba(0, 0, 0, 0.7)',
        'velvet-raised': '0 4px 16px -2px rgba(0, 0, 0, 0.65), 0 2px 6px rgba(0, 0, 0, 0.45)',
        'projector-beam': '0 0 35px -8px rgba(255, 159, 28, 0.28), 0 0 70px -15px rgba(255, 159, 28, 0.12)',
        'marquee-glow': '0 0 16px rgba(228, 87, 46, 0.4), 0 0 30px rgba(228, 87, 46, 0.18)',
        'cathode-glow': '0 0 10px rgba(46, 196, 182, 0.55), 0 0 20px rgba(46, 196, 182, 0.2)',
        'danger-burn': '0 0 16px rgba(214, 40, 57, 0.45)',
      },
      keyframes: {
        marqueeBulb: {
          '0%, 100%': { opacity: '1', filter: 'drop-shadow(0 0 6px rgba(255, 159, 28, 0.7))' },
          '50%': { opacity: '0.65', filter: 'drop-shadow(0 0 2px rgba(255, 159, 28, 0.25))' },
        },
        cathodePulse: {
          '0%, 100%': { boxShadow: '0 0 6px rgba(46, 196, 182, 0.8), 0 0 12px rgba(46, 196, 182, 0.3)' },
          '50%': { boxShadow: '0 0 2px rgba(46, 196, 182, 0.4), 0 0 6px rgba(46, 196, 182, 0.1)' },
        },
      },
      animation: {
        'marquee-bulb': 'marqueeBulb 2.4s infinite ease-in-out',
        'cathode-pulse': 'cathodePulse 2s infinite ease-in-out',
      },
    },
  },
  plugins: [],
};
