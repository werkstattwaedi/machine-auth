# Membership

Buying a single or family membership, what it grants, family invitations,
renewal, cancellation and expiry. Terms: see the
[glossary](README.md#glossary).

## Purchase

- **MEM-1** A badge tap alone never buys a membership (ACC-4); buying takes a signed-in account, at the kiosk a code entered in the last 15 min (ACC-5). — ADR-0041
- **MEM-2** A person with an active membership can't buy another one — renewal is automatic (MEM-24); a person whose membership expired can buy again.
- **MEM-3** Buying adds the membership to the buyer's open checkout, or opens a purchase-only checkout without a usage fee, and goes straight to the checkout summary.
- **MEM-4** A checkout holds at most one membership; while one waits there, the membership page only points to finishing that checkout.
- **MEM-5** A checkout with a membership can't be closed without a complete postal address, and that address is saved to the buyer's profile.
- **MEM-6** A checkout with a membership can't use the internal usage type. — #284
- **MEM-7** A membership becomes active when its bill's payment method is committed — by the buyer (CHK-22), by Wallee's confirmation of a terminal payment (BIL-39) or by the overnight job (BIL-7) — not when the payment is booked (BIL-34). — #251, ADR-0051
- **MEM-8** A membership is valid for one year; a renewal or an admin's extension (MEM-32) adds a year to its end date, or starts the year today if that date has already passed.
- **MEM-9** A membership has one price per type (single, family), the same for a first purchase and a renewal. — #743

## Benefits

- **MEM-10** While a membership is active, every member of it pays the member price wherever the catalog sets one — machine time from the terminal and items in the checkout alike, signed in or by badge tap. — #358
- **MEM-11** Whether an item gets the member price is decided once, when it is added to the visit — machine time when its session is uploaded, a checkout item when it is added — by whether the membership is active at that moment. — #743
- **MEM-12** Wherever a membership is advertised, the only discount promised is cheaper machine use, never cheaper material. — #665
- **MEM-13** A membership doesn't change the usage fee; member prices (MEM-10), paying by Sammelrechnung (BIL-4) and a free first badge (MEM-14) are its only benefits.
- **MEM-14** A person's first badge is free if they are an active member or hold any permission; while they have an active badge, every further one costs the catalog price. — ADR-0030

## Family

- **MEM-15** Only the family owner (or an admin) manages a family membership; an invited member can only leave. — ADR-0048, #747

  | Action | Family owner | Invited member | Admin |
  |---|---|---|---|
  | Invite by e-mail | yes | no | no — adds directly (MEM-33) |
  | Remove a member | anyone but the owner | only themselves | anyone but the owner |
  | End auto-renew | yes | no | yes |

- **MEM-16** An invitation goes to one e-mail address, names the family after the inviter, and expires after 30 days.
- **MEM-17** Only the account with the invited e-mail can accept or decline an invitation; another signed-in account is told it is the wrong account and offered to sign out.
- **MEM-18** A person without an account joins from the invitation link without a sign-in code; a person with an account signs in first.
- **MEM-19** A signed-in person sees the open invitations addressed to them on the membership page, and can accept or decline them there. — #569
- **MEM-20** A person belongs to at most one active membership; inviting, accepting or adding someone already in another one is refused.
- **MEM-36** A family membership holds the people who visit the workshop on their own, each with their own login; whoever only comes along is a further person on a member's check-in (CHK-6), not a member. — ADR-0048, #747
- **MEM-23** The family owner can't be removed and can't leave.

## Renewal & cancellation

- **MEM-24** About 30 days before the end date, an active membership with auto-renew gets one renewal bill (QR-Rechnung). — #323
- **MEM-25** Only the family owner receives the renewal bill; invited members are told that the membership renews, never that they will be billed. — #730

  | Membership | Viewer | Told they receive the renewal bill |
  |---|---|---|
  | single | member | yes |
  | family | family owner | yes |
  | family | invited member | no — told that the family owner does |

- **MEM-35** The renewal year is added when the renewal bill is committed, not when it is paid; an unpaid renewal is followed up at reconciliation (BIL-34). — #746
- **MEM-26** Auto-renew is on until someone ends it; ending it keeps the membership active until its end date and only stops the next renewal bill.
- **MEM-27** Only an admin cancels a membership (MEM-32); cancelling ends member status for all its members at once, and the membership is never reactivated — an admin creates a new one instead.

## Expiry

- **MEM-28** A membership stays active through the whole of its end date and expires in the night after it, when all its members lose member status at once. — #743
- **MEM-29** An expired membership is never renewed automatically; the membership page shows the expiry and offers a new purchase.

## Account page

- **MEM-30** At the kiosk, the membership page and every membership action need a code entered in the last 15 min (ACC-5). — ADR-0041
- **MEM-31** The membership page shows each person their own situation: — ADR-0048, #747

  | Person | Membership | Sees |
  |---|---|---|
  | anyone | none | single and family offers with prices — unless one waits in their checkout (MEM-4) |
  | single member | active | type, end date, auto-renew state, a way to end auto-renew |
  | family owner | active | the same, plus the members, open invitations (revocable) and inviting a member (MEM-16) |
  | invited member | active | type, end date, the members, and leaving as the only action; no way to end auto-renew (who is billed: MEM-25) |
  | anyone | expired | the expiry date and a way to buy again |
  | anyone | cancelled | that only the club administration can give them a membership again (MEM-27) |

## Admin

- **MEM-32** An admin can create a membership without payment for a person who has none, extend one by a year, end auto-renew and cancel.
- **MEM-33** An admin adds existing people directly to a family; no invitation mail is sent. — #622, ADR-0048, #747
- **MEM-34** The admin app counts a membership as expiring in its last 30 days, and shows a pending renewal bill on it.

## Open questions

- [NEEDS CLARIFICATION] Ending auto-renew after the renewal bill went out leaves the bill and the added year in place. Should ending auto-renew void a pending renewal bill?
- [NEEDS CLARIFICATION] Should a family owner be able to cancel the membership? The server allows it; the checkout app offers no way to, and the cancelled view says only the club administration can act.
- [NEEDS CLARIFICATION] A person whose membership was cancelled can't buy a new one themselves — the app offers no purchase (MEM-31), though the server would accept it. Intended, or should cancelled behave like expired (MEM-2)?
- [NEEDS CLARIFICATION] After a badge is deactivated (lost), the next badge is free again for an eligible person (MEM-14 counts active badges only). Intended?
- [NEEDS CLARIFICATION] An invited member is offered "buy again" after the family membership expired, which makes them the owner of a new membership at the normal price. Intended?
- [NEEDS CLARIFICATION] An expired invitation is refused when joining with a new account but can still be accepted by an existing account until it is cleaned up (MEM-16). Should both refuse it?
- [NEEDS CLARIFICATION] A family has no member limit. A decision, or an omission?
- [NEEDS CLARIFICATION] Open invitations aren't shown at check-in, only on the membership page (MEM-19). — #670

## Retired

<!-- `- MEM-n — <PR that retired it>` -->
- MEM-21 — #747 (members without a login are no longer added; ADR-0048)
- MEM-22 — #747 (family members are no longer added to a visit from the roster; ADR-0048)
