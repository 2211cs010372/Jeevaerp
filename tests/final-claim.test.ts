import { describe, it, expect } from "vitest";
import { authorisedAmount, excessOver, needsFinalClaim, openPreAuth, openFinalClaim } from "@/lib/final-claim";

/**
 * WHICH DISCHARGED STAYS THE INSURANCE DESK STILL OWES A CLAIM ON.
 *
 * The hospital's own words: the pre-auth carries an ESTIMATE, the insurer
 * authorises against it, and that authorisation settles the stay - unless the
 * bill went over, and then a final claim is sent for the rest.
 *
 * The worklist used to list every discharged insurance stay regardless, so
 * finished stays sat on it for ninety days asking for a claim nobody was going
 * to raise. A list that asks for work that does not exist is a list people stop
 * reading, and then it stops catching the stay that really is ₹20,000 short.
 */

const draftPreAuth = { status: "DRAFT", approvedAmount: null, settledAmount: null };
const approved = (n: number) => ({ status: "APPROVED", approvedAmount: String(n), settledAmount: null });

describe("what the insurer authorised", () => {
  it("is the approved figure when there is one", () => {
    expect(authorisedAmount(approved(140_000))).toBe(140_000);
  });

  it("falls back to what was settled - money in the bank authorises too", () => {
    // Some TPAs never send an approval figure, only a payment. Reading that as
    // "never authorised" would put a finished stay back on the worklist.
    expect(authorisedAmount({ status: "SETTLED", approvedAmount: null, settledAmount: "132500" })).toBe(132_500);
  });

  it("is null while the pre-auth is still a draft, or absent entirely", () => {
    expect(authorisedAmount(draftPreAuth)).toBeNull();
    expect(authorisedAmount(null)).toBeNull();
  });

  it("is null on a refusal - a rejection authorises nothing", () => {
    expect(authorisedAmount({ status: "REJECTED", approvedAmount: null, settledAmount: null })).toBeNull();
  });

  it("keeps a part-approval's figure, which is the whole point of one", () => {
    expect(authorisedAmount({ status: "PARTIALLY_APPROVED", approvedAmount: "90000", settledAmount: null })).toBe(90_000);
  });
});

describe("does this stay still owe a final claim", () => {
  it("no - it landed inside the estimate", () => {
    // ₹1,40,000 authorised, ₹1,35,000 billed. The authorisation settles it and
    // the desk has nothing left to send.
    expect(needsFinalClaim({ billedToInsurer: 135_000, authorised: 140_000, finalClaimStatus: null })).toBe(false);
  });

  it("yes - it went over, and that difference is what a final claim is for", () => {
    expect(needsFinalClaim({ billedToInsurer: 160_000, authorised: 140_000, finalClaimStatus: null })).toBe(true);
  });

  it("yes - nobody ever got it authorised", () => {
    // The expensive version of the same mistake: a whole bill no insurer has
    // been shown.
    expect(needsFinalClaim({ billedToInsurer: 160_000, authorised: null, finalClaimStatus: null })).toBe(true);
  });

  it("forgives paise, not money", () => {
    // Rounding puts a bill and a typed authorisation a few paise apart. Asking
    // for a claim over ₹0.40 teaches the desk to scroll past the list.
    expect(needsFinalClaim({ billedToInsurer: 140_000.4, authorised: 140_000, finalClaimStatus: null })).toBe(false);
    expect(needsFinalClaim({ billedToInsurer: 140_002, authorised: 140_000, finalClaimStatus: null })).toBe(true);
  });

  it("no - a claim is already with the insurer", () => {
    expect(needsFinalClaim({ billedToInsurer: 160_000, authorised: 140_000, finalClaimStatus: "SUBMITTED" })).toBe(false);
    expect(needsFinalClaim({ billedToInsurer: 160_000, authorised: 140_000, finalClaimStatus: "SETTLED" })).toBe(false);
  });

  it("yes - a DRAFT is a form somebody started and left", () => {
    expect(needsFinalClaim({ billedToInsurer: 160_000, authorised: 140_000, finalClaimStatus: "DRAFT" })).toBe(true);
  });

  it("no - the bills went back to the family, so there is nothing to claim", () => {
    // A refused claim reverted to self-pay leaves nothing pointed at the
    // insurer. Asking an insurer for ₹0 is not work.
    expect(needsFinalClaim({ billedToInsurer: 0, authorised: null, finalClaimStatus: null })).toBe(false);
  });
});

describe("how far over the estimate", () => {
  it("is the difference, for the claim that asks only for the excess", () => {
    expect(excessOver(160_000, 140_000)).toBe(20_000);
  });

  it("never goes negative - an under-run is not a credit note", () => {
    expect(excessOver(135_000, 140_000)).toBe(0);
  });

  it("is null when nothing was authorised - there is no estimate to be over", () => {
    expect(excessOver(160_000, null)).toBeNull();
  });
});

/**
 * WHICH OF THE TWO BUTTONS A STAY GETS.
 *
 * Both the stays list and the stay's own sheet draw a "Pre-auth" and a "Final
 * claim" button, and each has to vanish the moment its claim exists - otherwise
 * one stay ends up carrying two claims of the same stage and nobody can say
 * afterwards which one the insurer is looking at.
 */
const c = (stage: string, status: string) => ({ stage, status });

describe("the pre-auth still standing on a stay", () => {
  it("is null when no claim has been raised at all - so the button shows", () => {
    expect(openPreAuth([])).toBeNull();
  });

  it("is the draft the admission opened - one pre-auth per stay, not two", () => {
    expect(openPreAuth([c("PRE_AUTH", "DRAFT")])).toEqual(c("PRE_AUTH", "DRAFT"));
  });

  it("is the approved one, which is what takes the button away", () => {
    // The desk's own words: once the insurer authorises, the only claim left to
    // send is the final one.
    expect(openPreAuth([c("PRE_AUTH", "APPROVED")])).toEqual(c("PRE_AUTH", "APPROVED"));
  });

  it("ignores a refusal - a rejection authorises nothing, so a fresh one is owed", () => {
    expect(openPreAuth([c("PRE_AUTH", "REJECTED")])).toBeNull();
  });

  it("ignores a CLOSED draft - that is the unused ₹0 one somebody tidied away", () => {
    expect(openPreAuth([c("PRE_AUTH", "CLOSED")])).toBeNull();
  });

  it("does not mistake the final claim for one", () => {
    expect(openPreAuth([c("FINAL", "SUBMITTED")])).toBeNull();
  });
});

describe("the final claim still standing on a stay", () => {
  it("is null when none has been raised - so the button shows", () => {
    expect(openFinalClaim([c("PRE_AUTH", "APPROVED")])).toBeNull();
  });

  it("counts a draft - it is already on the screen with its own Send button", () => {
    expect(openFinalClaim([c("FINAL", "DRAFT")])).toEqual(c("FINAL", "DRAFT"));
  });

  it("counts a REJECTED one, unlike a pre-auth", () => {
    // The refusal panel owns that stay - re-submit, or move the bills back to
    // the family. A second "raise" button would compete with it.
    expect(openFinalClaim([c("FINAL", "REJECTED")])).toEqual(c("FINAL", "REJECTED"));
  });

  it("ignores a CLOSED one", () => {
    expect(openFinalClaim([c("FINAL", "CLOSED")])).toBeNull();
  });
});

describe("a stay carrying both", () => {
  const both = [c("PRE_AUTH", "APPROVED"), c("FINAL", "DRAFT")];

  it("offers neither button", () => {
    expect(openPreAuth(both)).not.toBeNull();
    expect(openFinalClaim(both)).not.toBeNull();
  });

  it("offers the pre-auth again once that one is refused", () => {
    const refused = [c("PRE_AUTH", "REJECTED"), c("FINAL", "DRAFT")];
    expect(openPreAuth(refused)).toBeNull();
    expect(openFinalClaim(refused)).not.toBeNull();
  });
});
