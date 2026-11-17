#[test_only]
module fieldtest_rewards::rewards_tests;

use fieldtest_rewards::rewards::{Self, Campaign};
use sui::clock;
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::test_scenario;

fun digest(): vector<u8> { vector[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1] }

/// Each rejection test names the expected module and exact abort code.
fun exercise(case: u64) {
    let mut s = test_scenario::begin(@0xA);
    let amount = if (case == 1) 19 else 20;
    let funding = coin::mint_for_testing<SUI>(amount, s.ctx());
    rewards::create(funding, if (case == 23) vector[1] else digest(), if (case == 20) 0 else 10, if (case == 21) 0 else if (case == 22) 51 else 2, if (case == 24) 0 else 1000, if (case == 25) 1000 else 2000, clock::borrow(), s.ctx());
    s.next_tx(@0xA);
    let mut c = s.take_shared<Campaign<SUI>>();
    if (case == 2) {
        test_scenario::return_shared(c);
        s.next_tx(@0xC);
        c = s.take_shared<Campaign<SUI>>();
    };
    rewards::enroll(&mut c, @0xB, clock::borrow(), s.ctx());
    if (case == 3) rewards::enroll(&mut c, @0xB, clock::borrow(), s.ctx());
    if (case == 4) rewards::enroll(&mut c, @0xA, clock::borrow(), s.ctx());
    if (case == 5) {
        rewards::enroll(&mut c, @0xC, clock::borrow(), s.ctx());
        rewards::enroll(&mut c, @0xD, clock::borrow(), s.ctx());
    };
    if (case == 6) rewards::refund(&mut c, clock::borrow(), s.ctx());
    if (case == 7) rewards::approve(&mut c, @0xB, digest(), clock::borrow(), s.ctx());
    test_scenario::return_shared(c);
    s.next_tx(if (case == 8) @0xC else @0xB);
    if (case == 9) { advance(&mut s, 1000); };
    let mut c = s.take_shared<Campaign<SUI>>();
    rewards::submit(&mut c, if (case == 10) vector[1] else digest(), clock::borrow(), s.ctx());
    if (case == 19) { let mut revision = digest(); *revision.borrow_mut(0) = 2; rewards::submit(&mut c, revision, clock::borrow(), s.ctx()); };
    test_scenario::return_shared(c);
    s.next_tx(if (case == 11) @0xC else @0xA);
    if (case == 12) { advance(&mut s, 2000); };
    let mut c = s.take_shared<Campaign<SUI>>();
    let mut reviewed = digest();
    if (case == 13 || case == 19) *reviewed.borrow_mut(0) = 2;
    rewards::approve(&mut c, @0xB, reviewed, clock::borrow(), s.ctx());
    assert!(rewards::is_paid(&c, @0xB), 100);
    assert!(rewards::remaining(&c) == 10, 101);
    if (case == 14) rewards::approve(&mut c, @0xB, digest(), clock::borrow(), s.ctx());
    test_scenario::return_shared(c);
    s.next_tx(@0xB);
    let payment = s.take_from_sender<Coin<SUI>>();
    assert!(coin::value(&payment) == 10, 102);
    coin::burn_for_testing(payment);
    if (case == 15) {
        let mut c = s.take_shared<Campaign<SUI>>();
        rewards::submit(&mut c, digest(), clock::borrow(), s.ctx());
        test_scenario::return_shared(c);
    };
    s.next_tx(if (case == 16) @0xC else @0xA);
    advance(&mut s, 2000);
    let mut c = s.take_shared<Campaign<SUI>>();
    rewards::refund(&mut c, clock::borrow(), s.ctx());
    assert!(rewards::remaining(&c) == 0, 103);
    if (case == 17) rewards::refund(&mut c, clock::borrow(), s.ctx());
    if (case == 18) rewards::enroll(&mut c, @0xD, clock::borrow(), s.ctx());
    test_scenario::return_shared(c);
    s.next_tx(@0xA);
    let refund = s.take_from_sender<Coin<SUI>>();
    assert!(coin::value(&refund) == 10, 104);
    coin::burn_for_testing(refund);
    s.end();
}

#[test] fun payout_and_refund_conserve_funds() { exercise(0) }
#[test, expected_failure(abort_code = 2, location = rewards)] fun wrong_funding() { exercise(1) }
#[test, expected_failure(abort_code = 0, location = rewards)] fun outsider_enrollment() { exercise(2) }
#[test, expected_failure(abort_code = 5, location = rewards)] fun duplicate_seat() { exercise(3) }
#[test, expected_failure(abort_code = 5, location = rewards)] fun builder_self_enrollment() { exercise(4) }
#[test, expected_failure(abort_code = 5, location = rewards)] fun capacity_limit() { exercise(5) }
#[test, expected_failure(abort_code = 8, location = rewards)] fun early_refund() { exercise(6) }
#[test, expected_failure(abort_code = 6, location = rewards)] fun no_submission_no_payment() { exercise(7) }
#[test, expected_failure(abort_code = 5, location = rewards)] fun outsider_submission() { exercise(8) }
#[test, expected_failure(abort_code = 4, location = rewards)] fun submission_deadline_boundary() { exercise(9) }
#[test, expected_failure(abort_code = 6, location = rewards)] fun malformed_submission_hash() { exercise(10) }
#[test, expected_failure(abort_code = 0, location = rewards)] fun outsider_payment() { exercise(11) }
#[test, expected_failure(abort_code = 4, location = rewards)] fun review_deadline_boundary() { exercise(12) }
#[test, expected_failure(abort_code = 6, location = rewards)] fun stale_review_digest() { exercise(13) }
#[test, expected_failure(abort_code = 7, location = rewards)] fun duplicate_payment() { exercise(14) }
#[test, expected_failure(abort_code = 7, location = rewards)] fun paid_submission_immutable() { exercise(15) }
#[test, expected_failure(abort_code = 0, location = rewards)] fun outsider_refund() { exercise(16) }
#[test, expected_failure(abort_code = 3, location = rewards)] fun duplicate_refund() { exercise(17) }
#[test, expected_failure(abort_code = 3, location = rewards)] fun closed_enrollment() { exercise(18) }



#[test] fun revised_submission_pays_exact_version() { exercise(19) }
#[test, expected_failure(abort_code = 1, location = rewards)] fun zero_reward() { exercise(20) }
#[test, expected_failure(abort_code = 1, location = rewards)] fun zero_slots() { exercise(21) }
#[test, expected_failure(abort_code = 1, location = rewards)] fun excessive_slots() { exercise(22) }
#[test, expected_failure(abort_code = 1, location = rewards)] fun malformed_terms_hash() { exercise(23) }
#[test, expected_failure(abort_code = 1, location = rewards)] fun past_submission_deadline() { exercise(24) }
#[test, expected_failure(abort_code = 1, location = rewards)] fun no_review_window() { exercise(25) }



fun advance(s: &mut test_scenario::Scenario, ms: u64) { let builder = s.ctx_builder().set_clock_timestamp(ms); s.next_with_context(builder); }

