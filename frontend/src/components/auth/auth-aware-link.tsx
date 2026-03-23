"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import { Link, useRouter } from "@/i18n/navigation";
import { isAuthed as isAuthedCookie, subscribeAuthChanged } from "@/lib/auth";

type Props = {
  guestHref: string;
  authedHref: string;
  children?: React.ReactNode;
  guestChildren?: React.ReactNode;
  authedChildren?: React.ReactNode;
  className?: string;
};

export default function AuthAwareLink({
  guestHref,
  authedHref,
  children,
  guestChildren,
  authedChildren,
  className,
}: Props) {
  const router = useRouter();
  const params = useParams<{ locale?: string }>();
  const locale = useMemo(() => params?.locale || "zh", [params]);
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    const update = () => setIsAuthed(isAuthedCookie());
    update();
    return subscribeAuthChanged(update);
  }, []);

  const href = isAuthed ? authedHref : guestHref;
  const content = isAuthed ? (authedChildren ?? children) : (guestChildren ?? children);

  return (
    <Link
      href={href}
      className={className}
      onClick={(e) => {
        if (
          e.defaultPrevented ||
          e.button !== 0 ||
          e.metaKey ||
          e.altKey ||
          e.ctrlKey ||
          e.shiftKey
        ) {
          return;
        }
        const target = isAuthedCookie() ? authedHref : guestHref;
        if (target !== href) {
          e.preventDefault();
          router.push(target, { locale });
        }
      }}
    >
      {content}
    </Link>
  );
}
