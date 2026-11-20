"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ResizableSplitProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Left side content */
  left: ReactNode;
  /** Right side content */
  right: ReactNode;
  /** Optional overlay elements (such as connector lines or floating badges) */
  overlay?: ReactNode;
  /** Default width percentage of the left panel (e.g. 50 or 42). Defaults to 50. */
  defaultWidth?: number;
  /** Minimum width percentage of the left panel. Defaults to 28. */
  minWidth?: number;
  /** Maximum width percentage of the left panel. Defaults to 76. */
  maxWidth?: number;
  /** Controlled width percentage of the left panel */
  width?: number;
  /** Callback when width changes */
  onWidthChange?: (width: number) => void;
  /** Optional localStorage key to persist user's preferred split width */
  storageKey?: string;
  /** Accessible label for the resizer separator */
  ariaLabel?: string;
  /** Additional class names for the resizer separator handle */
  dividerClassName?: string;
  /** Height class for the separator handle on desktop (e.g. "lg:h-[min(82vh,880px)]") */
  dividerHeightClassName?: string;
  /** Width of the divider column in pixels. Defaults to 10. */
  dividerWidth?: number;
  /** Keyboard step increment when using arrow keys. Defaults to 2. */
  step?: number;
  /** Optional additional ref to attach to the container */
  containerRef?: RefObject<HTMLDivElement | null>;
}

export const ResizableSplit = forwardRef<HTMLDivElement, ResizableSplitProps>(
  function ResizableSplit(
    {
      left,
      right,
      overlay,
      defaultWidth = 50,
      minWidth = 28,
      maxWidth = 76,
      width,
      onWidthChange,
      storageKey,
      ariaLabel = "Resize editor and preview",
      dividerClassName,
      dividerHeightClassName = "lg:h-[min(80vh,860px)]",
      dividerWidth = 10,
      step = 2,
      containerRef,
      className,
      style,
      ...props
    },
    forwardedRef
  ) {
    const localContainerRef = useRef<HTMLDivElement>(null);
    const [localWidth, setLocalWidth] = useState(defaultWidth);
    const [isDragging, setIsDragging] = useState(false);

    const isControlled = typeof width === "number";
    const currentWidth = isControlled ? width : localWidth;

    const setMergedRef = useCallback(
      (node: HTMLDivElement | null) => {
        localContainerRef.current = node;
        if (typeof forwardedRef === "function") {
          forwardedRef(node);
        } else if (forwardedRef) {
          (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        }
        if (containerRef) {
          containerRef.current = node;
        }
      },
      [forwardedRef, containerRef]
    );

    useEffect(() => {
      if (isControlled || !storageKey || typeof window === "undefined") return;
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const parsed = parseFloat(saved);
          if (!Number.isNaN(parsed) && parsed >= minWidth && parsed <= maxWidth) {
            setLocalWidth(parsed);
          }
        }
      } catch {
        // Ignore localStorage read errors
      }
    }, [isControlled, storageKey, minWidth, maxWidth]);

    const updateWidth = useCallback(
      (next: number) => {
        const clamped = Math.max(minWidth, Math.min(maxWidth, Math.round(next * 10) / 10));
        if (!isControlled) {
          setLocalWidth(clamped);
        }
        onWidthChange?.(clamped);
      },
      [isControlled, minWidth, maxWidth, onWidthChange]
    );

    const persistWidth = useCallback(
      (value: number) => {
        if (!storageKey || typeof window === "undefined") return;
        try {
          localStorage.setItem(storageKey, String(Math.round(value)));
        } catch {
          // Ignore localStorage write errors
        }
      },
      [storageKey]
    );

    const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsDragging(true);
    };

    const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId) || !localContainerRef.current) return;
      const rect = localContainerRef.current.getBoundingClientRect();
      const dividerOffset = dividerWidth / 2;
      const availableWidth = rect.width - dividerWidth;
      if (availableWidth <= 0) return;
      const rawPercentage = ((event.clientX - rect.left - dividerOffset) / availableWidth) * 100;
      updateWidth(rawPercentage);
    };

    const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Ignore release errors
      }
      setIsDragging(false);
      persistWidth(currentWidth);
    };

    const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Ignore release errors
      }
      setIsDragging(false);
    };

    const handleDoubleClick = () => {
      updateWidth(defaultWidth);
      if (storageKey && typeof window !== "undefined") {
        try {
          localStorage.removeItem(storageKey);
        } catch {
          // Ignore localStorage remove errors
        }
      }
    };

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        let next = currentWidth;
        if (event.key === "Home") {
          next = minWidth;
        } else if (event.key === "End") {
          next = maxWidth;
        } else if (event.key === "ArrowRight") {
          next = Math.min(maxWidth, currentWidth + step);
        } else if (event.key === "ArrowLeft") {
          next = Math.max(minWidth, currentWidth - step);
        }
        updateWidth(next);
        persistWidth(next);
      }
    };

    return (
      <div
        ref={setMergedRef}
        className={cn(
          "relative resizable-split verification-split grid min-w-0 items-start gap-y-3",
          isDragging && "select-none",
          className
        )}
        style={
          {
            "--left-width": `${currentWidth}fr`,
            "--right-width": `${100 - currentWidth}fr`,
            "--editor-width": `${currentWidth}fr`,
            "--preview-width": `${100 - currentWidth}fr`,
            ...style,
          } as CSSProperties
        }
        {...props}
      >
        {overlay}
        {left}
        <div
          role="separator"
          tabIndex={0}
          aria-label={ariaLabel}
          aria-orientation="vertical"
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          aria-valuenow={Math.round(currentWidth)}
          title="Drag to resize, double-click to reset"
          className={cn(
            "hidden cursor-col-resize touch-none items-center justify-center rounded bg-transparent outline-none transition-colors hover:bg-primary/10 focus-visible:bg-primary/15 lg:sticky lg:top-4 lg:flex lg:self-start",
            dividerHeightClassName,
            isDragging && "bg-primary/15",
            dividerClassName
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onLostPointerCapture={() => setIsDragging(false)}
          onDoubleClick={handleDoubleClick}
          onKeyDown={handleKeyDown}
        >
          <GripVertical className="size-3 text-muted-foreground" />
        </div>
        {right}
      </div>
    );
  }
);

ResizableSplit.displayName = "ResizableSplit";
