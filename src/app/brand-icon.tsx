export function BrandIcon({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="beaconBgBrand" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4F46E5" />
          <stop offset="45%" stopColor="#6366F1" />
          <stop offset="100%" stopColor="#7C3AED" />
        </linearGradient>
        <linearGradient id="beaconPulseBrand" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FDE047" />
          <stop offset="100%" stopColor="#F59E0B" />
        </linearGradient>
        <linearGradient id="waveGradBrand" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#E0E7FF" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#beaconBgBrand)" />
      <path d="M 11.5 6.8 A 11.4 11.4 0 0 1 22.9 18.2" stroke="url(#waveGradBrand)" strokeWidth="2.3" strokeLinecap="round" opacity="0.9" />
      <path d="M 11.5 11.8 A 6.4 6.4 0 0 1 17.9 18.2" stroke="#FFFFFF" strokeWidth="2.3" strokeLinecap="round" />
      <path d="M 11.5 25.5 C 9.8 23.2 7.5 20.6 7.5 18.2 C 7.5 15.99 9.29 14.2 11.5 14.2 C 13.71 14.2 15.5 15.99 15.5 18.2 C 15.5 20.6 13.2 23.2 11.5 25.5 Z" fill="#FFFFFF" />
      <circle cx="11.5" cy="18.2" r="2.1" fill="url(#beaconPulseBrand)" />
      <path d="M 24 5.5 L 24.8 8.2 L 27.5 9 L 24.8 9.8 L 24 12.5 L 23.2 9.8 L 20.5 9 L 23.2 8.2 Z" fill="#FDE047" />
    </svg>
  );
}
