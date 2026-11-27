"use client";

import type { BudgetInput } from "./finance";
import type { Listing } from "./listings/types";
import type { AssetType } from "./types";

// Hand-off from İlan Bulucu to the application form. Kept in sessionStorage, not in the URL,
// so income and savings never end up in links, logs or analytics.

export interface Selection {
  type: AssetType;
  city: string;
  budget: BudgetInput;
  listing: Listing | null;
}

const KEY = "glasshouse:selection";

export function saveSelection(s: Selection) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage can be blocked; the form then starts empty
  }
}

export function loadSelection(): Selection | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Selection) : null;
  } catch {
    return null;
  }
}

/**
 * Salted hash of the listing (URL + key fields). Only this hash and the value band go on-chain;
 * the salt stays with the borrower so they can later prove which listing it was.
 */
export async function listingRefHash(listing: Listing): Promise<{ hash: string; salt: string }> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = Array.from(saltBytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const content = JSON.stringify({ url: listing.url, title: listing.title, price: listing.price, city: listing.city, id: listing.id });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + content));
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    localStorage.setItem(`glasshouse:salt:${hash}`, salt);
  } catch {
    // ignore
  }
  return { hash, salt };
}
