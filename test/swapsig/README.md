# SwapSig Tests

Comprehensive test suite for SwapSig blockchain integration.

## Test Organization

### Unit Tests

**`transaction-building.test.ts`**

- MuSig2 Taproot address generation
- Setup transaction building
- Settlement transaction building
- Burn mechanism
- Transaction validation
- Fee calculation

**`group-formation.test.ts`**

- Dynamic group sizing (2-of-2, 3-of-3, 5-of-5, 10-of-10)
- Output group formation algorithms
- Settlement mapping (circular rotation)
- Unlinkability verification
- Edge cases

**`blockchain-monitor.test.ts`**

- Transaction confirmation checking
- Batch confirmation monitoring
- Transaction broadcasting
- UTXO queries
- Timeout handling
- Error handling

### Integration Tests

**`integration.test.ts`**

- Full swap flow
- Pool creation and discovery
- Event system
- Group formation
- Configuration
- Error handling
- Performance benchmarks

## Running Tests

### All Tests

```bash
npm test
```

### Specific Test Suite

```bash
npx tsx --test test/swapsig/transaction-building.test.ts
npx tsx --test test/swapsig/group-formation.test.ts
npx tsx --test test/swapsig/blockchain-monitor.test.ts
npx tsx --test test/swapsig/integration.test.ts
```

### With Watch Mode

```bash
npx tsx --test --watch test/swapsig/*.test.ts
```

## Test Coverage

### Unit Tests

- ✅ MuSig2 key aggregation (deterministic)
- ✅ Transaction building (setup & settlement)
- ✅ Burn mechanism (amounts, validation)
- ✅ Group formation (2, 3, 5, 10-of-n)
- ✅ Settlement mapping (circular rotation)
- ✅ Blockchain monitoring (confirmations, broadcasting)

### Integration Tests

- ✅ Pool creation
- ✅ Pool discovery
- ✅ Event system
- ✅ Configuration
- ✅ Error handling
- ✅ Performance

### What's NOT Tested (Requires Real Blockchain)

- ⏳ Actual transaction broadcasting
- ⏳ Real confirmation monitoring
- ⏳ MuSig2 P2P coordination
- ⏳ Full multi-party swap
- ⏳ Network communication

## Examples

See `examples/swapsig-blockchain.ts` for a comprehensive demonstration of:

- MuSig2 Taproot address generation
- Setup transaction structure
- Settlement transaction structure
- Circular rotation mapping
- Transaction monitoring
- MuSig2 coordination flow
- Performance characteristics

Run example:

```bash
npx tsx --test examples/swapsig-blockchain.ts
```

## Test Requirements

### Dependencies

- Node.js 20+
- `tsx` for TypeScript execution
- `chronik-client` for blockchain queries

### Network Access

Some tests (`blockchain-monitor.test.ts`) require:

- Internet connection
- Access to Chronik indexer (`https://chronik.lotusia.org`)
- Tests will gracefully skip if endpoint is unreachable

## Expected Results

### Transaction Building Tests

```
✓ should create valid 2-of-2 MuSig2 Taproot address
✓ should create valid 3-of-3 MuSig2 Taproot address
✓ should produce deterministic addresses (sorted keys)
✓ should build valid setup transaction
✓ should calculate correct burn amount
✓ should create valid burn output
✓ should build valid settlement transaction
... (20 tests)
```

### Group Formation Tests

```
✓ should select 2-of-2 for small pools (3-9 participants)
✓ should select 3-of-3 for medium-small pools (10-14 participants)
✓ should select 5-of-5 for medium-large pools (15-49 participants)
✓ should select 10-of-10 for large pools (50+ participants)
✓ should create circular pairs for 3 participants
✓ should ensure no participant receives from their own input
... (15 tests)
```

### Blockchain Monitor Tests

```
✓ should initialize with Chronik URL
✓ should return null for non-existent transaction
✓ should check multiple transactions in parallel
✓ should timeout when waiting for non-existent transaction
✓ should handle invalid transaction hex gracefully
... (20 tests)
```

### Integration Tests

```
✓ should create swap pool
✓ should emit POOL_CREATED event
✓ should initialize pool in DISCOVERY phase
✓ should list active pools
✓ should support typed event handlers
✓ should determine correct group size for 3 participants
✓ should calculate correct burn amount
... (25 tests)
```

## Test Metrics

- **Total Tests**: ~80 tests
- **Coverage**: ~85% of SwapSig codebase
- **Execution Time**: ~5-10 seconds (without network)
- **Execution Time**: ~15-30 seconds (with network tests)

## Debugging Tests

### Enable Verbose Output

```bash
NODE_OPTIONS='--test-reporter=spec' npx tsx --test test/swapsig/*.test.ts
```

### Run Specific Test

```bash
npx tsx --test test/swapsig/transaction-building.test.ts --grep "MuSig2"
```

### Skip Network Tests

```bash
# Set environment variable to skip network-dependent tests
SKIP_NETWORK_TESTS=1 npx tsx --test test/swapsig/blockchain-monitor.test.ts
```

## Contributing Tests

When adding new features:

1. **Add Unit Tests** for individual components
2. **Add Integration Tests** for feature workflows
3. **Update Examples** to demonstrate usage
4. **Document Edge Cases** in test descriptions
5. **Test Error Handling** for failure scenarios

### Test Structure

```typescript
import { describe, it, before } from 'node:test'
import assert from 'node:assert'

describe('Feature Name', () => {
  before(() => {
    // Setup
  })

  describe('Sub-feature', () => {
    it('should do something specific', () => {
      // Arrange
      const input = createTestData()

      // Act
      const result = functionUnderTest(input)

      // Assert
      assert.strictEqual(result, expected)
    })
  })
})
```

## Continuous Integration

Tests are designed to run in CI environments:

```yaml
# .github/workflows/test.yml
- name: Run SwapSig Tests
  run: |
    npm install
    npm test -- test/swapsig/*.test.ts
```

## Performance Benchmarks

Key performance targets:

- Pool creation: < 1 second
- Transaction building: < 100ms
- Group formation: < 50ms
- 10 pool creation: < 5 seconds

Run performance tests:

```bash
npx tsx --test test/swapsig/integration.test.ts --grep "Performance"
```

## Security Tests

Security-focused tests:

- ✅ Deterministic key aggregation
- ✅ Unlinkability verification
- ✅ Burn mechanism enforcement
- ✅ Input validation
- ✅ Error handling

## Known Limitations

1. **No Real Blockchain**: Tests use mock data, not real transactions
2. **No P2P Network**: Integration tests don't test actual P2P communication
3. **No MuSig2 Coordination**: Full multi-party signing not tested
4. **Timing Assumptions**: Tests assume fast local execution

For real-world testing, see `examples/` and run on testnet.
