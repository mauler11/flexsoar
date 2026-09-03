"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/components/ui/cn";

const XIcon = () => (
  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

interface ImageZoomProps {
  /** Image sources to zoom through */
  images: string[];
  /** Starting index */
  initialIndex?: number;
  /** Alt text */
  alt?: string;
  /** Trigger element to open zoom (optional - can be controlled externally) */
  children?: React.ReactNode;
  /** Whether zoom is open (controlled) */
  isOpen?: boolean;
  /** Callback when closed */
  onClose?: () => void;
}

export function ImageZoom({
  images,
  initialIndex = 0,
  alt,
  children,
  isOpen: controlledIsOpen,
  onClose,
}: ImageZoomProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [touchStart, setTouchStart] = useState<{ x: number; y: number; distance: number } | null>(null);

  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const isOpen = controlledIsOpen ?? internalIsOpen;

  // Reset when image changes
  useEffect(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, [currentIndex]);

  const open = () => {
    if (!controlledIsOpen) setInternalIsOpen(true);
    setCurrentIndex(initialIndex);
    setScale(1);
    setPosition({ x: 0, y: 0 });
    document.body.style.overflow = "hidden";
  };

  const close = () => {
    if (!controlledIsOpen) setInternalIsOpen(false);
    setScale(1);
    setPosition({ x: 0, y: 0 });
    document.body.style.overflow = "";
    onClose?.();
  };

  const next = () => setCurrentIndex((i) => (i + 1) % images.length);
  const prev = () => setCurrentIndex((i) => (i - 1 + images.length) % images.length);

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setScale((s) => Math.max(1, Math.min(5, s - e.deltaY * 0.001)));
  };

  // Mouse drag to pan
  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    e.preventDefault();
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  // Touch pinch zoom + pan
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      // Single touch - start drag
      setTouchStart({
        x: e.touches[0].clientX - position.x,
        y: e.touches[0].clientY - position.y,
        distance: 0,
      });
    } else if (e.touches.length === 2) {
      // Two touches - start pinch
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      setTouchStart({
        x: 0,
        y: 0,
        distance,
      });
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    e.preventDefault();
    if (!touchStart) return;

    if (e.touches.length === 1 && touchStart.distance === 0) {
      // Pan
      setPosition({
        x: e.touches[0].clientX - touchStart.x,
        y: e.touches[0].clientY - touchStart.y,
      });
    } else if (e.touches.length === 2 && touchStart.distance > 0) {
      // Pinch zoom
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const zoomFactor = distance / touchStart.distance;
      setScale((s) => Math.max(1, Math.min(5, s * zoomFactor)));
      setTouchStart((prev) => prev ? { ...prev, distance } : null);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length === 0) setTouchStart(null);
  };

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen]);

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) close();
  };

  if (!isOpen && !children) return null;

  return (
    <>
      {children && (
        <button
          type="button"
          onClick={open}
          className="w-full h-full"
          aria-label="Zoom image"
        >
          {children}
        </button>
      )}

      {isOpen && (
        <div
          className={cn(
            "fixed inset-0 z-50 bg-black/95 flex items-center justify-center",
            "animate-in fade-in-100 duration-150"
          )}
          onClick={handleBackdropClick}
          role="dialog"
          aria-modal="true"
          aria-label="Image zoom"
        >
          {/* Close button */}
          <button
            type="button"
            onClick={close}
            className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            aria-label="Close zoom"
          >
            <XIcon />
          </button>

          {/* Navigation */}
          {images.length > 1 && (
            <>
              <button
                type="button"
                onClick={prev}
                className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors hidden sm:block"
                aria-label="Previous image"
              >
                <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={next}
                className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors hidden sm:block"
                aria-label="Next image"
              >
                <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </>
          )}

          {/* Image counter */}
          {images.length > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/70 text-sm font-mono">
              {currentIndex + 1} / {images.length}
            </div>
          )}

          {/* Zoomable image */}
          <div
            ref={containerRef}
            className="relative w-full h-full max-w-[90vw] max-h-[90vh] flex items-center justify-center touch-none"
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            style={{ touchAction: "pinch-zoom" }}
          >
            <img
              ref={imgRef}
              src={images[currentIndex]}
              alt={alt}
              className="max-w-[90vw] max-h-[90vh] object-contain transition-transform duration-100"
              style={{
                transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                transformOrigin: "center center",
              }}
              draggable={false}
            />
          </div>

          {/* Zoom indicator */}
          {scale > 1 && (
            <div className="absolute bottom-12 left-1/2 -translate-x-1/2 text-white/60 text-xs font-mono px-2 py-1 bg-black/50 rounded">
              {Math.round(scale * 100)}%
            </div>
          )}
        </div>
      )}
    </>
  );
}