/**
 * Because the use of ABIEncoderV2 , the pragma should be locked above 0.5.10 ,
 * as there is a known bug in array storage:
 * https://blog.ethereum.org/2019/06/25/solidity-storage-array-bugs/
 */
pragma solidity >=0.5.10 <0.6.0;
pragma experimental ABIEncoderV2;

import {Ownable} from "./Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {RTokenStorage} from "./RTokenStorage.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";

contract RTokenRewards is RTokenStorage, Ownable{
  using SafeMath for uint256;

  /// @dev Value to scale numbers to avoid rounding issues
  uint256 constant SCALING_FACTOR = 1e18;

  event RewardsCollected(uint256 amount);
  event RewardsWithdrawn(address owner, uint256 amount);

  // @notice Set fee for percentage taken of the rewards token by admin
  // @param fee The fee expressed as a percentage relative to 1e18. e.g. for 10%, fee = 1e17
  function setRewardsFee(uint256 fee) external onlyOwner {
    require(fee < 1e18, 'Fee cannot be 100% or above');
    adminRewardsFee = fee;
  }

  function setRewardsToken(address erc20) external onlyOwner {
    require(erc20 != address(0), 'Rewards token cannot be null address');
    if (address(rewardsToken) != address(0)) {
      collectRewards();
      withdrawAdminRewards();
    }
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
      updateRewards(owner);
      Account storage account = accounts[owner];
      amount = account.lRewardsOwed.div(SCALING_FACTOR);
      if (amount > 0) {
        account.lRewardsOwed = 0;
        rewardStats[address(rewardsToken)].rewardsWithdrawn =
            rewardStats[address(rewardsToken)].rewardsWithdrawn.add(amount);
        require(rewardsToken.transfer(owner, amount));
        emit RewardsWithdrawn(owner, amount);
      }
  }

  function withdrawPastRewards(address erc20)
      public returns (uint256) {
      require(erc20 != address(rewardsToken), 'Cannnot get past rewards on current rewards token');
      address storedToken = accounts[msg.sender].lRewardsAddress;
      if (storedToken == erc20) {
          resetRewards(msg.sender);
      }
      bytes32 rewardsOwedId =
          keccak256(abi.encodePacked(msg.sender, storedToken));
      uint256 rewardsOwed = pastRewards[rewardsOwedId].div(SCALING_FACTOR);
      IERC20(erc20).transfer(msg.sender, rewardsOwed);
      delete pastRewards[rewardsOwedId];
      return rewardsOwed;
  }

  function withdrawAdminRewards() public onlyOwner {
      rewardsToken.transfer(_owner, adminRewards);
      adminRewards = 0;
  }

  // @notice Anyone may redeem rewards from the Allocation Strategy to this contract
  function collectRewards() public returns (uint256 amount){
      require(address(rewardsToken) != address(0), 'Rewards token not set');
      amount = ias.redeemArbitraryTokens(rewardsToken);
      if (adminRewardsFee > 0) {
        uint256 fee = amount.mul(adminRewardsFee).div(1e18);
        adminRewards = adminRewards.add(fee);
        amount = amount.sub(fee);
      }
      RewardsStatsStored storage rewardStat = rewardStats[address(rewardsToken)];
      rewardStat.rewardsCollected = rewardStat.rewardsCollected.add(amount);
      rewardStat.rewardsPerToken = rewardStat.rewardsPerToken
          .add(amount.mul(SCALING_FACTOR)
          .div(totalSupply));
      emit RewardsCollected(amount);
  }

  // @notice Update account with latest rewards
  function updateRewards(address owner) internal {
      Account storage account = accounts[owner];
      if (account.lRewardsAddress != address(rewardsToken)) {
          resetRewards(owner);
      }
      account.lRewardsOwed = calcLatestRewards(account, address(rewardsToken));
      account.lRewardsPerToken = rewardStats[address(rewardsToken)].rewardsPerToken;
  }

  // @notice Calculates new rewards owed to user since last calculation
  function calcLatestRewards(Account storage account, address erc20)
      private view
      returns (uint256)
  {
      if(account.lRewardsAddress != erc20) {
        // Account isn't tracking requested token, assume account variables are zero
        uint256 rewardsPerTokenDiff = rewardStats[erc20].rewardsPerToken;
        return rewardsPerTokenDiff
            .mul(account.lDebt.add(account.rInterest));
      } else {
        uint256 rewardsPerTokenDiff = rewardStats[erc20].rewardsPerToken
            .sub(account.lRewardsPerToken);
        return rewardsPerTokenDiff
            .mul(account.lDebt.add(account.rInterest))
            .add(account.lRewardsOwed);
      }
  }

  // @notice finalizes rewards for old token and resets reward data
  function resetRewards(address owner) private {
    Account storage account = accounts[owner];
    if(account.lRewardsAddress != address(0)) {
      //Finalize the rewards owed on previous rewards token
      pastRewards[keccak256(abi.encodePacked(
        owner,
        account.lRewardsAddress
      ))] = calcLatestRewards(account, account.lRewardsAddress);
      //Reset rewards data
      account.lRewardsOwed = 0;
      account.lRewardsPerToken = 0;
    }
    //Set new rewards address
    account.lRewardsAddress = address(rewardsToken);
  }

  // @notice Retrieve rewards owed and scales them down to wei format
  function getRewardsOwed(address owner) external view returns (uint256) {
      Account storage account = accounts[owner];
      return calcLatestRewards(account, address(rewardsToken)).div(SCALING_FACTOR);
  }

  function getPastRewardsOwed(address owner, address erc20)
      external view
      returns(uint256) {
      Account storage account = accounts[owner];
      if(account.lRewardsAddress == erc20) {
        return calcLatestRewards(account, erc20).div(SCALING_FACTOR);
      } else {
        return pastRewards[keccak256(abi.encodePacked(msg.sender, erc20))]
            .div(SCALING_FACTOR);
      }
  }
}
