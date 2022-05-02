// SPDX-License-Identifier: GPL-2.0-or-later

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice This contract is for mocking a lending platform.
/// @dev This contract does not consider several types of collaterals and should be modified a lot for production.
contract MockLending {    
    // a structure for loans
    struct Loan {
        address borrower;               // borrower wallet
        uint256 id;                     // unique id of loans in this platform
        uint256 amount;                 // amount of X token that requests by loan
        uint256 collateralAmount;       // amount of stEth used as collaterals
        uint256 timestamp;              // timestamp
    }

    // a structure for borrower deposits
    struct Deposit {
        address borrower;               // borrower wallet who are willing to borrow X
        uint256 id;                     // unique id of deposits in this platform
        uint256 amount;                 // amount of stEth token
        uint256 timestamp;              // timestamp
    }

    // interest rate APY
    uint16 private interest = 1000; // This is for 10% APY, This should be MODIFIED based on some pricnciples for production. 

    // exchange rate between stEth and X
    uint256 private exRate = 2800; // This should be MODIFIED to be extracted from Chainlink.

    // collateral ratio
    uint32 private collateralRatio = 120; // This value can be different between addresses, in case this should be implemented as a mapping.

    // address of collaterial token
    address public stEthAddress;

    // address of X token
    address public xAddress;

    // a variable that stores collateral deposits of each person
    mapping(address => uint256) private collaterals;
    
    // histories of loan and deposit
    Loan[] private loanHistory;
    Deposit[] private depositHistory;

    // events
    event Deposited(address indexed _from, uint256 _amount);
    event Borrowed(address indexed _to, uint256 _amount);
    event Repaid(address indexed _from, uint256 _amount);

    /// @notice A function to deposit collaterals to this platform.
    /// @param _amount collateral amount
    /// @return totalAmount the amount of collaterals that the sender has now
    function deposit(uint256 _amount) external returns(uint256 totalAmount) {
        // check if the sender wallet has sufficient fund
        require(IERC20(stEthAddress).balanceOf(msg.sender) >= _amount, "Insufficient collateral funds.");

        // transfer token
        IERC20(stEthAddress).approve(address(this), _amount);
        IERC20(stEthAddress).transferFrom(msg.sender, address(this), _amount);

        // add to collateral deposits
        collaterals[msg.sender] = collaterals[msg.sender] + _amount;

        // add to history
        depositHistory.push(Deposit(msg.sender, depositHistory.length + 1, _amount, block.timestamp));

        // emit an event
        emit Deposited(msg.sender, _amount);

        // return
        totalAmount = collaterals[msg.sender];
    }
    
    /// @notice A function that allows users to borrow X tokens from this platform.
    /// @param _amount The amount of X a user wants to borrow from this platform.
    /// @return success It indicates the borrowing has been successfully carried out.
    function borrow(uint256 _amount) external returns (bool success) {
        // check if the user has deposited enough collateral
        require(collaterals[msg.sender] >= _amount * collateralRatio / exRate, "Insufficient collaterals.");

        // check if this contract has enough X token to be borrowed
        require(IERC20(xAddress).balanceOf(address(this)) >= _amount, "This market has been deprecated.");

        // transfer
        IERC20(xAddress).transfer(msg.sender, _amount);

        // reduce collateral of borrower
        collaterals[msg.sender] = collaterals[msg.sender] - collateralRatio * _amount / exRate;

        // add to history
        loanHistory.push(Loan(msg.sender, depositHistory.length + 1, _amount, collateralRatio * _amount / exRate, block.timestamp));

        // emit an event
        emit Borrowed(msg.sender, _amount);

        return true;
    }

    function setCollateralAddress(address _addr) external {
        require(_addr != address(0));
        stEthAddress = _addr;
    }
}