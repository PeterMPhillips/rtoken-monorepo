pragma solidity >=0.5.10 <0.6.0;

/**
 * @notice RToken storage structures
 */
contract RTokenStructs {

    /**
     * @notice Global stats
     */
    struct GlobalStats {
        /// @notice Total redeemable tokens supply
        uint256 totalSupply;
        /// @notice Total saving assets in redeemable amount
        uint256 totalSavingsAmount;
    }

    /**
     * @notice Account stats stored
     */
    struct AccountStatsView {
        /// @notice Current hat ID
        uint256 hatID;
        /// @notice Current redeemable amount
        uint256 rAmount;
        /// @notice Interest portion of the rAmount
        uint256 rInterest;
        /// @notice Current loaned debt amount
        uint256 lDebt;
        /// @notice Current internal savings amount
        uint256 sInternalAmount;
        /// @notice Interest payable
        uint256 rInterestPayable;
        /// @notice Cumulative interest generated for the account
        uint256 cumulativeInterest;
        /// @notice Loans lent to the recipients
        uint256 lRecipientsSum;
    }

    /**
     * @notice Account stats stored
     */
    struct AccountStatsStored {
        /// @notice Cumulative interest generated for the account
        uint256 cumulativeInterest;
    }

    /**
     * @notice Hat stats view
     */
    struct HatStatsView {
        /// @notice Number of addresses has the hat
        uint256 useCount;
        /// @notice Total net loans distributed through the hat
        uint256 totalLoans;
        /// @notice Total net savings distributed through the hat
        uint256 totalSavings;
    }

    /**
     * @notice Hat stats stored
     */
    struct HatStatsStored {
        /// @notice Number of addresses has the hat
        uint256 useCount;
        /// @notice Total net loans distributed through the hat
        uint256 totalLoans;
        /// @notice Total net savings distributed through the hat
        uint256 totalInternalSavings;
    }

    /**
     * @notice Hat structure describes who are the recipients of the interest
     *
     * To be a valid hat structure:
     *   - at least one recipient
     *   - recipients.length == proportions.length
     *   - each value in proportions should be greater than 0
     */
    struct Hat {
        address[] recipients;
        uint32[] proportions;
    }

    /// @dev Account structure
    struct Account {
        /// @notice Current selected hat ID of the account
        uint256 hatID;
        /// @notice Current balance of the account (non realtime)
        uint256 rAmount;
        /// @notice Interest rate portion of the rAmount
        uint256 rInterest;
        /// @notice Debt in redeemable amount lent to recipients
        //          In case of self-hat, external debt is optimized to not to
        //          be stored in lRecipients
        mapping(address => uint256) lRecipients;
        /// @notice Received loan.
        ///         Debt in redeemable amount owed to the lenders distributed
        ///         through one or more hats.
        uint256 lDebt;
        /// @notice Savings internal accounting amount.
        ///         Debt is sold to buy savings
        uint256 sInternalAmount;


        /// @notice Rewards address
        address lRewardsAddress;
        /// @notice Rewards owed to account. For distributing reward tokens
        ///         earned on the loan via an incentive scheme, e.g. COMP
        uint256 lRewardsOwed;
        /// @notice The rewardsPerToken value from the last time rewards owed
        ///         was calculated. This acts as a snapshot to calculate new
        ///         rewards.
        uint256 lRewardsPerToken;
        /// @notice Stored interest fee for account
        uint256 rInterestFee;
    }

    /// @dev Reward token stats
    struct RewardsStatsStored {
        /// @dev The current value each rToken has received in the reward token
        uint256 rewardsPerToken;
        /// @dev The amount of the reward token this contract has collected
        uint256 rewardsCollected;
        /// @dev The amount of the reward token that has been withdrawn from contract
        uint256 rewardsWithdrawn;
    }

    /**
     * Additional Definitions:
     *
     *   - rGross = sInternalToR(sInternalAmount)
     *   - lRecipientsSum = sum(lRecipients)
     *   - interestPayable = rGross - lDebt - rInterest
     *   - realtimeBalance = rAmount + interestPayable
     *
     *   - rAmount aka. tokenBalance
     *   - rGross aka. receivedSavings
     *   - lDebt aka. receivedLoan
     *
     * Account Invariants:
     *
     *   - rAmount = lRecipientsSum + rInterest [with rounding errors]
     *
     * Global Invariants:
     *
     * - globalStats.totalSupply = sum(account.tokenBalance)
     * - globalStats.totalSavingsAmount = sum(account.receivedSavings) [with rounding errors]
     * - sum(hatStats.totalLoans) = sum(account.receivedLoan)
     * - sum(hatStats.totalSavings) = sum(account.receivedSavings + cumulativeInterest - rInterest) [with rounding errors]
     *
     */
}
