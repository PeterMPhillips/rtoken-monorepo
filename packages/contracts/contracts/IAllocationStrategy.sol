pragma solidity ^0.5.8;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
/**
 * @notice Allocation strategy for assets.
 *         - It invests the underlying assets into some yield generating contracts,
 *           usually lending contracts, in return it gets new assets aka. saving assets.
 *         - Savings assets can be redeemed back to the underlying assets plus interest any time.
 */
interface IAllocationStrategy {
    /**
     * @notice Set withdrawal address for tokens sent to contract
     * @param account The account that can withdraw tokens
     */
    function setWithdrawAddress(address account) external;

    /**
     * @notice Underlying asset for the strategy
     * @return address Underlying asset address
     */
    function underlying() external view returns (address);

    /**
     * @notice Calculates the exchange rate from underlying to saving assets
     * @return uint256 Calculated exchange rate scaled by 1e18
     *
     * NOTE:
     *
     *   underlying = savingAssets × exchangeRate
     */
    function exchangeRateStored() external view returns (uint256);

    /**
      * @notice Applies accrued interest to all savings
      * @dev This should calculates interest accrued from the last checkpointed
      *      block up to the current block and writes new checkpoint to storage.
      * @return bool success(true) or failure(false)
      */
    function accrueInterest() external returns (bool);

    /**
     * @notice Sender supplies underlying assets into the market and receives saving assets in exchange
     * @dev Interst shall be accrued
     * @param investAmount The amount of the underlying asset to supply
     * @return uint256 Amount of saving assets created
     */
    function investUnderlying(uint256 investAmount) external returns (uint256);

    /**
     * @notice Sender redeems saving assets in exchange for a specified amount of underlying asset
     * @dev Interst shall be accrued
     * @param redeemAmount The amount of underlying to redeem
     * @return uint256 Amount of saving assets burned
     */
    function redeemUnderlying(uint256 redeemAmount) external returns (uint256);

    /**
     * @notice Owner redeems all saving assets
     * @dev Interst shall be accrued
     * @return uint256 savingsAmount Amount of savings redeemed
     * @return uint256 underlyingAmount Amount of underlying redeemed
     */
    function redeemAll() external returns (uint256 savingsAmount, uint256 underlyingAmount);

    /**
     * @notice Owner redeems reward tokens sent to this contract.
     * @dev Implementation should block the transfer of the investment assets such as the underlying asset or cTokens
     * @param erc20 The address of the ERC20 token
     * @return uint256 Amount of tokens held by this contract
     */
    function redeemArbitraryTokens(IERC20 erc20) external returns (uint256);

}
