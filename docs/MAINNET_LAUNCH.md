# Mainnet Launch Runbook

This runbook provides step-by-step procedures for launching High Table Protocol on mainnet in June 2026.

## Section 1: Pre-Launch Checklist

### 1.1 Security Audit
1. Submit KIP-17 covenant logic to external security auditor
2. Receive and address all critical findings
3. Complete final security code review
4. Run automated security scanning tools (Clippy, cargo-audit)
5. Document all security vulnerabilities and their resolution

**Rollback:** If critical issues found, delay launch until resolved

### 1.2 Fee Review
1. Verify fee engine calculations for mainnet gas costs
2. Test fee aggregation mechanisms
3. Validate minimum bet thresholds accommodate fees
4. Review fee distribution logic for HTP governance token
5. Load test fee calculation under peak conditions

**Rollback:** Adjust fee structure or threshold amounts if economic model unsustainable

### 1.3 Key Custody
1. Generate mainnet signing keys for attestors
2. Distribute keys to 5 designated M-of-N attestors
3. Test key recovery procedures
4. Establish secure backup procedures
5. Document key rotation schedule

**Rollback:** Delay launch if key custody procedures incomplete

### 1.4 Domain SSL
1. Acquire mainnet domain (not hightable420.web.app)
2. Configure SSL certificates
3. Set up DNS records with security headers
4. Enable DDoS protection
5. Configure CDN for global distribution

**Rollback:** Use backup domain if primary SSL issues occur

## Section 2: Mainnet RPC Configuration

### 2.1 Resolver Pattern Setup
1. Configure primary mainnet RPC endpoint (e.g., api.mainnet.kaspa.org)
2. Set up 2+ backup RPC providers
3. Implement health check endpoints
4. Configure automatic failover logic
5. Test RPC failover scenarios

**Rollback:** Manually switch to backup endpoints if resolver fails

### 2.2 Load Balancing
1. Deploy RPC load balancers across 3+ geographic regions
2. Configure health checks with automatic degradation
3. Set up rate limiting per user/IP
4. Monitor RPC latency and response times
5. Test manual failover procedures

**Rollback:** Disable load balancing, route directly to healthy RPC

## Section 3: Oracle Migration

### 3.1 Firebase Deprecation Plan
1. Deploy decentralized oracle service
2. Configure attestor registration smart contract
3. Test oracle consensus mechanism
4. Validate M-of-N signature verification
5. Test oracle failover to next attestor

**Rollback:** Continue using Firebase as backup if decentralized oracle fails

### 3.2 Oracle Testing
1. Run integration tests with local blockchain
2. Simulate network partitions
3. Test timing attacks on oracle response
4. Validate oracle signature verification
5. Test cross-region oracle coordination

**Rollback:** Return to Firebase bridge if serious oracle issues discovered

## Section 4: Token Launch

### 4.1 HTP Governance Token
1. Deploy HTP governance token smart contract
2. Configure token distribution model:
   - 40% community incentives
   - 25% team allocation
   - 15% advisors
   - 10% marketing/media
   - 10% protocol treasury
3. Set up liquidity pools
4. Configure governance UI
5. Test voting mechanisms

**Rollback:** Disable token launch features if critical issues found

### 4.2 Staking Protocol
1. Deploy staking smart contracts
2. Configure reward distribution mechanics
3. Test unstaking and cooldown periods
4. Validate slashing conditions
5. Test emergency pause mechanisms

**Rollback:** Disable staking if security issues identified

## Section 5: DNS Cutover

### 5.1 DNS Migration Plan
1. Configure new mainnet domain DNS records
2. Set up proper CNAME records for replication
3. Deploy CDN configuration
4. Test DNS propagation
5. Verify SSL certificate deployment

**Rollback:** Revert to hightable420.web.app if DNS issues occur

### 5.2 Go-Live Process
1. Lower TTL values prior to migration
2. Update DNS records at scheduled time
3. Monitor propagation across global DNS
4. Verify all endpoints resolve correctly
5. Test critical user journeys

**Rollback:** Immediately revert DNS changes in case of failures

## Section 6: Post-Launch Monitoring

### 6.1 Block Explorer Links
1. Kaspa mainnet explorer integration
2. Covenant deployment verification
3. Token contract verification and linking
4. Real-time transaction monitoring
5. Fee calculation verification

**Rollback:** Investigate and fix any blockchain integration issues

### 6.2 Health Checks
1. Monitor application error rates
2. Track RPC endpoint responsiveness
3. Validate fee engine calculations
4. Monitor attestor network performance
5. Test incident response procedures

**Rollback:** Scale down or disable features causing health check failures

### Emergency Procedures

**Critical Bug Discovery:**
1. Immediately report to security team
2. Assess impact and risk
3. Deploy hotfix within agreed SLA
4. Coordinate communications to users
5. Conduct post-mortem analysis

**Attestor Network Failure:**
1. Switch to backup attestors
2. Increase fee for orphan contracts
3. Coordinate with remaining attestors
4. Investigate and resolve root cause
5. Add new attestors to network

**Main Integration Failure:**
1. Disable covenant creation temporarily
2. Switch to Firebase bridge as temporary backup
3. Investigate root cause
4. Deploy fix
5. Resume normal operations after verification