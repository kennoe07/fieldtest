/// Prototype reward escrow. Research content and personal data stay off chain.
module fieldtest_rewards::rewards;

use sui::balance::{Self, Balance};
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::event;

const EOwner: u64 = 0;
const ETerms: u64 = 1;
const EFunding: u64 = 2;
const EClosed: u64 = 3;
const EDeadline: u64 = 4;
const ESeat: u64 = 5;
const ESubmission: u64 = 6;
const EAlreadyPaid: u64 = 7;
const ERefundEarly: u64 = 8;

public struct Seat has store, drop {
    tester: address,
    submission_hash: vector<u8>,
    paid: bool,
}

public struct Campaign<phantom T> has key {
    id: UID,
    owner: address,
    /// Hash of a canonical, versioned campaign document; NOT a Supabase identifier.
    terms_hash: vector<u8>,
    reward: u64,
    slots: u64,
    submit_until_ms: u64,
    review_until_ms: u64,
    funds: Balance<T>,
    seats: vector<Seat>,
    closed: bool,
}

public struct Funded has copy, drop { campaign: ID, owner: address, amount: u64 }
public struct Enrolled has copy, drop { campaign: ID, tester: address }
public struct Submitted has copy, drop { campaign: ID, tester: address, digest: vector<u8> }
public struct Paid has copy, drop { campaign: ID, tester: address, amount: u64 }
public struct Refunded has copy, drop { campaign: ID, amount: u64 }

/// Amounts are integer base units of T. No fees or mutable reward terms.
public fun create<T>(
    funding: Coin<T>, terms_hash: vector<u8>, reward: u64, slots: u64,
    submit_until_ms: u64, review_until_ms: u64, clock: &Clock, ctx: &mut TxContext,
) {
    let campaign = new(funding, terms_hash, reward, slots, submit_until_ms, review_until_ms, clock, ctx);
    event::emit(Funded { campaign: object::id(&campaign), owner: campaign.owner, amount: balance::value(&campaign.funds) });
    transfer::share_object(campaign);
}

fun new<T>(funding: Coin<T>, terms_hash: vector<u8>, reward: u64, slots: u64,
    submit_until_ms: u64, review_until_ms: u64, clock: &Clock, ctx: &mut TxContext,
): Campaign<T> {
    assert!(terms_hash.length() == 32 && reward > 0 && slots > 0 && slots <= 50, ETerms);
    assert!(submit_until_ms > clock::timestamp_ms(clock) && review_until_ms > submit_until_ms, ETerms);
    // Multiplication aborts on overflow before funds are consumed.
    assert!(coin::value(&funding) == reward * slots, EFunding);
    Campaign { id: object::new(ctx), owner: ctx.sender(), terms_hash, reward, slots,
        submit_until_ms, review_until_ms, funds: coin::into_balance(funding), seats: vector[], closed: false }
}

/// Owner assigns a verified tester wallet; public callers cannot squat in seats.
/// Email identity / wallet proof must be checked by the application before this call.
public fun enroll<T>(campaign: &mut Campaign<T>, tester: address, clock: &Clock, ctx: &TxContext) {
    assert!(ctx.sender() == campaign.owner, EOwner);
    assert!(!campaign.closed, EClosed);
    assert!(clock::timestamp_ms(clock) < campaign.submit_until_ms, EDeadline);
    assert!(tester != @0x0 && tester != campaign.owner && campaign.seats.length() < campaign.slots, ESeat);
    let mut i = 0;
    while (i < campaign.seats.length()) {
        assert!(campaign.seats[i].tester != tester, ESeat);
        i = i + 1;
    };
    campaign.seats.push_back(Seat { tester, submission_hash: vector[], paid: false });
    event::emit(Enrolled { campaign: object::id(campaign), tester });
}

/// Tester signs their own submission commitment. Revisions may replace it before
/// the submission deadline, but a paid submission can never change.
public fun submit<T>(campaign: &mut Campaign<T>, digest: vector<u8>, clock: &Clock, ctx: &TxContext) {
    assert!(!campaign.closed, EClosed);
    assert!(clock::timestamp_ms(clock) < campaign.submit_until_ms, EDeadline);
    assert!(digest.length() == 32, ESubmission);
    let index = seat_index(campaign, ctx.sender());
    assert!(!campaign.seats[index].paid, EAlreadyPaid);
    campaign.seats[index].submission_hash = digest;
    event::emit(Submitted { campaign: object::id(campaign), tester: ctx.sender(), digest });
}

/// Approval and transfer are atomic. Digest pins the exact reviewed version;
/// a tester revision racing approval causes an abort instead of paying stale work.
public fun approve<T>(campaign: &mut Campaign<T>, tester: address, digest: vector<u8>, clock: &Clock, ctx: &mut TxContext) {
    assert!(ctx.sender() == campaign.owner, EOwner);
    assert!(!campaign.closed, EClosed);
    assert!(clock::timestamp_ms(clock) < campaign.review_until_ms, EDeadline);
    let index = seat_index(campaign, tester);
    assert!(!campaign.seats[index].paid, EAlreadyPaid);
    assert!(digest.length() == 32 && campaign.seats[index].submission_hash == digest, ESubmission);
    campaign.seats[index].paid = true;
    let payment = coin::take(&mut campaign.funds, campaign.reward, ctx);
    transfer::public_transfer(payment, tester);
    event::emit(Paid { campaign: object::id(campaign), tester, amount: campaign.reward });
}

/// No early cancellation or withdrawal. Paid rewards cannot be clawed back.
public fun refund<T>(campaign: &mut Campaign<T>, clock: &Clock, ctx: &mut TxContext) {
    assert!(ctx.sender() == campaign.owner, EOwner);
    assert!(!campaign.closed, EClosed);
    assert!(clock::timestamp_ms(clock) >= campaign.review_until_ms, ERefundEarly);
    campaign.closed = true;
    let amount = balance::value(&campaign.funds);
    if (amount > 0) transfer::public_transfer(coin::take(&mut campaign.funds, amount, ctx), campaign.owner);
    event::emit(Refunded { campaign: object::id(campaign), amount });
}

fun seat_index<T>(campaign: &Campaign<T>, tester: address): u64 {
    let mut i = 0;
    while (i < campaign.seats.length()) {
        if (campaign.seats[i].tester == tester) return i;
        i = i + 1;
    };
    abort ESeat
}

public fun remaining<T>(campaign: &Campaign<T>): u64 { balance::value(&campaign.funds) }
public fun is_paid<T>(campaign: &Campaign<T>, tester: address): bool { campaign.seats[seat_index(campaign, tester)].paid }


