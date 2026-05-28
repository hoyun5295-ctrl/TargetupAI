/**
 * Body data-hjl-* attribute 자동 감지 + identify 추출.
 * §12 #2 — data-hjl-* 접두사 흐름.
 * MutationObserver = body 단독 + 짧은 window 한정.
 */

export interface IdentifyResult {
  externalId: string;
  email?: string;
  phone?: string;
  name?: string;
}

const ATTR_USER_ID = 'data-hjl-user-id';
const ATTR_EMAIL = 'data-hjl-email';
const ATTR_PHONE = 'data-hjl-phone';
const ATTR_NAME = 'data-hjl-name';

export function detectIdentify(): IdentifyResult | null {
  if (typeof document === 'undefined' || !document.body) {
    return null;
  }
  const externalId = document.body.getAttribute(ATTR_USER_ID);
  if (!externalId) {
    return null;
  }
  const result: IdentifyResult = { externalId };
  const email = document.body.getAttribute(ATTR_EMAIL);
  const phone = document.body.getAttribute(ATTR_PHONE);
  const name = document.body.getAttribute(ATTR_NAME);
  if (email) result.email = email;
  if (phone) result.phone = phone;
  if (name) result.name = name;
  return result;
}

export function watchIdentifyChanges(
  callback: (result: IdentifyResult | null) => void,
): () => void {
  if (typeof MutationObserver === 'undefined' || !document.body) {
    return () => {};
  }
  let lastUserId = document.body.getAttribute(ATTR_USER_ID);
  const observer = new MutationObserver(() => {
    const currentUserId = document.body.getAttribute(ATTR_USER_ID);
    if (currentUserId !== lastUserId) {
      lastUserId = currentUserId;
      callback(detectIdentify());
    }
  });
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: [ATTR_USER_ID, ATTR_EMAIL, ATTR_PHONE, ATTR_NAME],
  });
  return () => observer.disconnect();
}
