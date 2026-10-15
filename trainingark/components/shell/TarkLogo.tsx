interface TarkLogoProps {
  size?: 'small' | 'nav' | 'hero' | 'loading'
}

const sizes = {
  small: { w: 120, h: 52 },
  nav: { w: 150, h: 65 },
  hero: { w: 300, h: 130 },
  loading: { w: 420, h: 182 },
}

export function TarkLogo({ size = 'nav' }: TarkLogoProps) {
  const { w, h } = sizes[size]

  return (
    <svg width={w} height={h} viewBox="0 0 300 130" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="tarkGold" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#e8c96a" />
                <stop offset="60%" stopColor="#c9a84c" />
                <stop offset="100%" stopColor="#a07828" />
            </linearGradient>
        </defs>
      <polygon points="38,118 58,30 74,30 54,118" fill="url(#tarkGold)" />
      <rect x="12" y="28" width="213" height="14" fill="url(#tarkGold)" />
      <polygon points="224,28 258,28 224,54" fill="#a07828" />
      <text
          x="75" y="112"
          fontFamily="'Trebuchet MS', sans-serif"
          fontSize="88"
          fontWeight="600"
          fill="#e8e0d4"
          letterSpacing="8"
      >ARK</text>
    </svg>
  )
}
