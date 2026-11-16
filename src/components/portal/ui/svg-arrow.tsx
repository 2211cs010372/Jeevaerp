import React from "react";

export interface SvgArrowProps {
  size?: number;
  className?: string;
  direction?: "right" | "left" | "up" | "down";
}

/**
 * Modern vector SVG Arrow with smooth lines and hover animation support.
 * Replaces static text arrows (->, →, ›) with crisp, accessible vector graphics.
 */
export function SvgArrow({
  size = 14,
  className = "",
  direction = "right",
}: SvgArrowProps) {
  const rotation = {
    right: "",
    left: "rotate-180",
    up: "-rotate-90",
    down: "rotate-90",
  }[direction];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block shrink-0 align-middle transition-transform duration-200 ${rotation} ${className}`}
      aria-hidden="true"
    >
      <path d="M2.5 8h10.5M9 4.5l3.5 3.5-3.5 3.5" />
    </svg>
  );
}
