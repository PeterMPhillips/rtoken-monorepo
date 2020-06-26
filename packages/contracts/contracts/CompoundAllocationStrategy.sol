pragma solidity >=0.5.10 <0.6.0;

import {IAllocationStrategy} from "./IAllocationStrategy.sol";
import {Ownable} from "@openzeppelin/contracts/ownership/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CErc20Interface} from "../compound/contracts/CErc20Interface.sol";

contract CompoundAllocationStrategy is IAllocationStrategy, Ownable {

    CErc20Interface private cToken;
    IERC20 private token;

    address public withdrawAddress;

    constructor(CErc20Interface cToken_) public {
        cToken = cToken_;
        token = IERC20(cToken.underlying());
    }

    function setWithdrawAddress(address account) external onlyOwner {
      require(account != address(0));
      withdrawAddress = account;
    }

    /// @dev ISavingStrategy.underlying implementation
    function underlying() external view returns (address) {
        return cToken.underlying();
    }

    /// @dev ISavingStrategy.exchangeRateStored implementation
    function exchangeRateStored() external view returns (uint256) {
        return cToken.exchangeRateStored();
    }

    /// @dev ISavingStrategy.accrueInterest implementation
    function accrueInterest() external returns (bool) {
        return cToken.accrueInterest() == 0;
    }

    /// @dev ISavingStrategy.investUnderlying implementation
    function investUnderlying(uint256 investAmount) external onlyOwner returns (uint256) {
        token.transferFrom(msg.sender, address(this), investAmount);
        token.approve(address(cToken), investAmount);
        uint256 cTotalBefore = cToken.totalSupply();
        // TODO should we handle mint failure?
        require(cToken.mint(investAmount) == 0, "mint failed");
        uint256 cTotalAfter = cToken.totalSupply();
        uint256 cCreatedAmount;
        require (cTotalAfter >= cTotalBefore, "Compound minted negative amount!?");
        cCreatedAmount = cTotalAfter - cTotalBefore;
        return cCreatedAmount;
    }

    /// @dev ISavingStrategy.redeemUnderlying implementation
    function redeemUnderlying(uint256 redeemAmount) external onlyOwner returns (uint256) {
        uint256 cTotalBefore = cToken.totalSupply();
        // TODO should we handle redeem failure?
        require(cToken.redeemUnderlying(redeemAmount) == 0, "cToken.redeemUnderlying failed");
        uint256 cTotalAfter = cToken.totalSupply();
        uint256 cBurnedAmount;
        require(cTotalAfter <= cTotalBefore, "Compound redeemed negative amount!?");
        cBurnedAmount = cTotalBefore - cTotalAfter;
        token.transfer(msg.sender, redeemAmount);
        return cBurnedAmount;
    }

    /// @dev ISavingStrategy.redeemAll implementation
    function redeemAll() external onlyOwner
        returns (uint256 savingsAmount, uint256 underlyingAmount) {
        savingsAmount = cToken.balanceOf(address(this));
        require(cToken.redeem(savingsAmount) == 0, "cToken.redeem failed");
        underlyingAmount = token.balanceOf(address(this));
        token.transfer(msg.sender, underlyingAmount);
    }

    function redeemArbitraryTokens(IERC20 erc20) external
      returns (uint256 tokenAmount) {
      require(msg.sender == withdrawAddress, "msg.sender not withdrawAddress");
      require(address(erc20) != address(token), "cannot redeem underlying token");
      require(address(erc20) != address(cToken), "cannot redeem cToken");
      tokenAmount = erc20.balanceOf(address(this));
      require(tokenAmount > 0, "zero balance");
      erc20.transfer(msg.sender, tokenAmount);
    }

}
