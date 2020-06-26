/**
 * Because the use of ABIEncoderV2 , the pragma should be locked above 0.5.10 ,
 * as there is a known bug in array storage:
 * https://blog.ethereum.org/2019/06/25/solidity-storage-array-bugs/
 */
pragma solidity >=0.5.10 <0.6.0;
pragma experimental ABIEncoderV2;

import {Ownable} from "./Ownable.sol";
import {IERC20} from "./IRToken.sol";
import {RTokenStorage} from "./RTokenStorage.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";

contract RTokenRewards is RTokenStorage, Ownable{
  using SafeMath for uint256;
  uint256 constant scalingFactor = 1e32;  //Value to scale numbers to avoid rounding issues

  IERC20 private rewardsToken;            //The rewards token, e.g. COMP
  uint256 public rewardsPerToken;         //The current value each rToken has received in the reward token
  uint256 public rewardsCollected;        //The amount of the reward token this contract has collected
  uint256 public rewardsWithdrawn;        //The amount of the reward token that has been withdrawn from contract

  event RewardsCollected(uint256 amount);
  event RewardsWithdrawn(address owner, uint256 amount);

  function setRewardsToken(address erc20) external onlyOwner {
    require(erc20 != address(0));
    require(address(rewardsToken) == address(0)); //Can only be set once
    rewardsToken = IERC20(erc20);
  }

  function setWithdrawAddress(address account) external onlyOwner {
    ias.setWithdrawAddress(account);
  }

  // @notice rToken holders can withdraw rewards here
  function withdrawRewards() external returns (uint256 amount){
      return withdrawRewardsInternal(msg.sender);
  }

  function withdrawRewardsInternal(address owner)
      internal returns (uint256 amount){
      Account storage account = accounts[owner];
      updateRewards(account);
      amount = account.lRewardsOwed.div(scalingFactor);
      account.lRewardsOwed = 0;
      rewardsWithdrawn = rewardsWithdrawn.add(amount);
      require(rewardsToken.transfer(owner, amount));
      emit RewardsWithdrawn(owner, amount);
  }

  // @notice Anyone may redeem rewards from the Allocation Strategy to this contract
  function collectRewards() external returns (uint256 amount){
      require(address(rewardsToken) != address(0), 'Rewards token not set');
      amount = ias.redeemArbitraryTokens(rewardsToken);
      rewardsCollected = rewardsCollected.add(amount);
      rewardsPerToken = rewardsPerToken.add(amount.mul(scalingFactor).div(totalSupply));
      emit RewardsCollected(amount);
  }

  // @notice Update account with latest rewards
  function updateRewards(Account storage account) internal {
      account.lRewardsOwed = calcLatestRewards(account);
      account.lRewardsPerToken = rewardsPerToken;
  }

  // @notice Calculates new rewards owed to user since last calculation
  function calcLatestRewards(Account storage account)
      internal
      view
      returns (uint256)
  {
      uint256 rewardsPerTokenDiff = rewardsPerToken.sub(account.lRewardsPerToken);
      return rewardsPerTokenDiff.mul(account.rAmount).add(account.lRewardsOwed);
  }

  // @notice Retrieve rewards owed and scales them down to wei format
  function getRewardsOwed(address owner)
      external
      view
      returns (uint256)
  {
      Account storage account = accounts[owner];
      return calcLatestRewards(account).div(scalingFactor);
  }
}
