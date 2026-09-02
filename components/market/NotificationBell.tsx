"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/components/ui/cn";
import { Button } from "@/components/ui/Button";
import { formatUsd } from "@/components/card/format";
import { markNotificationReadAction } from "@/app/(market)/actions";

export interface Notification {
  id: string;
  type: "submission_approved" | "card_sold" | "card_redeemed" | "payout_sent";
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  link?: string;
  linkLabel?: string;
}

interface NotificationBellProps {
  notifications: Notification[];
  unreadCount: number;
}

export function NotificationBell({
  notifications,
  unreadCount,
}: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMounted(true);
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleMarkRead = async (id: string) => {
    await markNotificationReadAction(id);
    // Optimistic update would be nice but this is a full page refresh action
    window.location.reload();
  };

  const formatTime = (iso: string): string => {
    if (!mounted) return "";
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const getTypeIcon = (type: Notification["type"]) => {
    switch (type) {
      case "submission_approved":
        return (
          <svg className="h-4 w-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case "card_sold":
        return (
          <svg className="h-4 w-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case "card_redeemed":
        return (
          <svg className="h-4 w-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2M7 7h10" />
          </svg>
        );
      case "payout_sent":
        return (
          <svg className="h-4 w-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
    }
  };

  if (notifications.length === 0) {
    return (
      <div className="relative">
        <Button
          ref={buttonRef}
          variant="ghost"
          size="sm"
          onClick={() => setIsOpen(!isOpen)}
          aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : "No notifications"}
          className="relative"
        >
          <svg className="h-5 w-5 text-muted hover:text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[#0B0B0B] font-mono text-[9px] font-black">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>

        {isOpen && (
          <div
            ref={dropdownRef}
            className="absolute right-0 mt-2 w-80 bg-raised border border-line rounded-lg pixel-shadow-lg animate-in fade-in-50 slide-in-from-top-2 duration-150 z-50"
          >
            <div className="p-3 border-b border-line font-mono text-sm font-bold uppercase tracking-tight">
              Notifications
            </div>
            <div className="p-3 text-center text-muted font-mono text-[11px]">
              No notifications yet
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <Button
        ref={buttonRef}
        variant="ghost"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={`${unreadCount} unread notifications`}
        className="relative"
      >
        <svg className="h-5 w-5 text-muted hover:text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[#0B0B0B] font-mono text-[9px] font-black">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Button>

      {isOpen && (
        <div
          ref={dropdownRef}
          className="absolute right-0 mt-2 w-80 bg-raised border border-line rounded-lg pixel-shadow-lg animate-in fade-in-50 slide-in-from-top-2 duration-150 z-50"
        >
          <div className="p-3 border-b border-line flex items-center justify-between font-mono text-sm font-bold uppercase tracking-tight">
            <span>Notifications</span>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => notifications.filter(n => !n.read).forEach(n => handleMarkRead(n.id))}
                className="text-[10px] text-accent hover:text-accent/80"
              >
                Mark all read
              </Button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={cn(
                  "p-3 border-b border-line/50 hover:bg-overlay/50 transition-colors",
                  !notification.read && "bg-overlay/30"
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    {getTypeIcon(notification.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={cn(
                        "font-mono text-sm tracking-tight truncate",
                        !notification.read ? "font-bold text-foreground" : "text-muted/90"
                      )}>
                        {notification.title}
                      </p>
                      <span className="shrink-0 font-mono text-[9px] uppercase tracking-tight text-muted">
                        {mounted ? formatTime(notification.createdAt) : ""}
                      </span>
                    </div>
                    <p className={cn(
                        "mt-1 font-mono text-[11px] tracking-tight truncate",
                        !notification.read ? "text-muted/90" : "text-muted/70"
                      )}>
                      {notification.body}
                    </p>
                    {notification.link && notification.linkLabel && (
                      <a
                        href={notification.link}
                        className="mt-2 inline-block font-mono text-[10px] uppercase tracking-tight text-accent hover:underline"
                      >
                        {notification.linkLabel}
                      </a>
                    )}
                    {!notification.read && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleMarkRead(notification.id)}
                        className="mt-2 text-[10px] text-muted hover:text-accent"
                      >
                        Mark as read
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}