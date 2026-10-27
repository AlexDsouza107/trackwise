/* ApproveIt brand: the logo mark (public/logo-mark.png) and the two-tone wordmark. */
export const BRAND_NAME = 'ApproveIt';
export const TAGLINE = 'AICTE approvals. Simplified.';

export function LogoMark({ size, className = '' }: { size: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo-mark.png"
      alt=""
      width={size}
      height={size}
      className={`shrink-0 rounded-[22%] object-cover shadow-[0_6px_18px_-8px_rgba(72,37,47,0.55)] ${className}`}
    />
  );
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-extrabold tracking-[-0.03em] ${className}`}>
      Approve<span style={{ color: 'var(--wordmark-accent)' }}>It</span>
    </span>
  );
}
