# Knight Online Client .TBL File Format - Control Flow Analysis

This document explains step-by-step how this repository reads Knight Online client .tbl files, including exact file locations, function names, and code snippets.

## Control Flow Map

```
readFile → decryption → parseHeader → parseColumns → parseRows → parseStrings
```

Detailed breakdown:
```
1. File I/O (lib/reader.js or lib/reader_direct.js)
   ↓
2. Encryption Detection & Decryption (decryption/index.js)
   ↓ (tries standard.js, then checks plain format)
3. Parse Header: Column Count (lib/parser.js, offset 0)
   ↓
4. Parse Column Types (lib/parser.js, offset 4 to 4+columnCount*4)
   ↓
5. Parse Row Count (lib/parser.js, offset 4+columnCount*4)
   ↓
6. Parse Rows with Inline String Data (lib/parser.js, iterates rowCount times)
```

---

## 1. Where Does the .tbl File Get Read From Disk?

### File: `lib/reader.js`
**Function**: Main exported async function (lines 10-219)

```javascript
let buffer;

try {
  buffer = await fse.readFile(file);
} catch (e) {
  messageBox.log(`${logHeader}\n${e.stack}`, function () {
    process.exit(1);
  });
  return;
}
```

**Lines**: 43-52

The file is read into a raw buffer using `fs-extra`'s `readFile()` method. The entire file content is loaded into memory as a `Buffer` object.

### Alternative Entry Point: `lib/reader_direct.js`
**Function**: Main exported async function `readerDirect` (lines 7-38)

```javascript
let buffer;

try {
  buffer = await fse.readFile(file);
} catch (e) {
  console.error(`${e.stack}`);
  process.exit(1);
}
```

**Lines**: 8-16

This is used when the `-j` (JSON output) flag is specified in the CLI.

### CLI Entry Point: `bin/tblread.js`
The file path comes from command-line arguments and is passed to either `reader` or `reader_direct`:

```javascript
if (program.json) {
  reader_direct(program.args[0], program.korean).catch((err) => {
    console.error("error ocurred! \n" + err.stack);
  });
} else {
  reader(program.args[0], program.korean).catch((err) => {
    console.error("error ocurred! \n" + err.stack);
  });
}
```

**Lines**: 16-24

---

## 2. When is Encryption/Decryption Applied?

### File: `lib/reader.js`
**After file reading, before parsing** (lines 54-79):

```javascript
messageBox.log(`${logHeader}\nDecryption on progress...`, 0);
let result, out_buffer;

try {
  [result, out_buffer] = await decryption(buffer);
} catch (e) {
  messageBox.log(
    `${logHeader}\nfile: ${file}\nencryption: unknown`,
    function () {
      process.exit(0);
    },
    5
  );
  return;
}

if (!result) {
  messageBox.log(
    `${logHeader}\nfile: ${file}\nencryption: unknown`,
    function () {
      process.exit(0);
    },
    5
  );
  return;
}
```

**Lines**: 54-79

The `decryption` function returns:
- `result`: A string indicating the encryption type ("standard", "plain format", etc.)
- `out_buffer`: The decrypted buffer ready for parsing

### File: `decryption/index.js`
**Function**: `decryption` (lines 5-22)

```javascript
async function decryption(buffer) {
  let temp = Buffer.allocUnsafe(buffer.length); // allocate some temp

  if (standard.determine(buffer, temp)) {
    return ["standard", standard.decode(buffer)];
  }

  if (validCheck(buffer)) {
    return "plain format";
  }

  // if (double.determine(buffer, temp)) {
  //   return ["double", double.decode(buffer)];
  // }
  return [];
}
```

**Lines**: 5-20

The decryption flow:
1. **Try "standard" encryption** (`decryption/standard.js`)
2. **Try plain format** (no encryption, via `lib/valid_check.js`)
3. **"double" encryption is disabled** (commented out due to issues with 1886 TBL files)

---

## 3. Standard Encryption Details

### File: `decryption/standard.js`

#### Determination Phase
**Function**: `standardDetermine` (lines 16-41)

```javascript
exports.determine = function standardDetermine(buffer, temp) {
  let v = 0x0816;
  let max = buffer.length;

  for (let i = 0; i < max; i++) {
    let data = buffer[i];
    let out = data ^ (v >> 8);
    v = ((data + v) * 0x6081 + 0x1608) & 0xffff;
    temp[i] = out;

    if (i == 3) {
      let amount = temp.readInt32LE(0);

      if (amount > 1000 || amount < 1) return false; // we do not accept 1000+ columns
      max = amount * 4 + 4;
    } else if (i % 4 == 0 && i != 0 && i != 4) {
      let headerType = temp.readInt32LE(i - 4);

      if (headerType > 11 || headerType < 0) {
        return false; // invalid header type
      }
    }
  }

  return true;
};
```

**Lines**: 16-41

The determination function:
1. Attempts to decrypt the first part of the buffer
2. Checks if byte 0-3 (after decryption) is a valid column count (1-1000)
3. Validates that column type values are in range 0-11
4. **Only decrypts and validates the header portion** (column count + column types)

#### Decryption Algorithm
**Function**: `standardDecode` (lines 1-14)

```javascript
exports.decode = function standardDecode(buffer, x1, x2, x3) {
  let key1 = x1 | 0x0816;
  let key2 = x2 | 0x6081;
  let key3 = x3 | 0x1608;

  for (let i = 0; i < buffer.length; i++) {
    let data = buffer[i];
    let out = data ^ (key1 >> 8);
    key1 = ((data + key1) * key2 + key3) & 0xffff;
    buffer[i] = out;
  }

  return buffer;
};
```

**Lines**: 1-14

**Encryption Type**: XOR cipher with a rolling key
- Initial key: `0x0816`
- Multiplier: `0x6081`
- Increment: `0x1608`
- The key evolves after each byte: `key1 = ((encrypted_byte + key1) * 0x6081 + 0x1608) & 0xffff`

**Note**: Parameters `x1`, `x2`, `x3` are optional overrides (default to 0, which then get OR'd with the constants).

---

## 4. Plain Format Validation

### File: `lib/valid_check.js`
**Function**: `validCheck` (lines 1-13)

```javascript
module.exports = function validCheck(buffer) {
  let headerSize = buffer.readInt32LE(0);

  if (headerSize > 500) return false;

  for (let i = 0; i < headerSize && i * 4 + 8 < buffer.length; i++) {
    let headerType = buffer.readInt32LE(4 * i + 4);

    if (headerType < 1 || headerType > 8) return false;
  }

  return true;
};
```

**Lines**: 1-13

This validates that the buffer is an unencrypted TBL file:
1. Reads column count from offset 0 (must be ≤ 500)
2. Validates each column type is in range 1-8
3. **Note**: This only accepts types 1-8, while the parser supports types 1-11

**Assumption by repo author**: Plain format files don't use types 9-11 (double, long, ulong).

---

## 5. Decrypted Byte Buffer Structure

After decryption, the buffer has this layout:

```
[Column Count: 4 bytes, int32LE]
[Column Type 1: 4 bytes, int32LE]
[Column Type 2: 4 bytes, int32LE]
...
[Column Type N: 4 bytes, int32LE]
[Row Count: 4 bytes, int32LE]
[Row Data: variable length]
```

### File: `lib/parser.js`
**Function**: Main exported async function (lines 3-85)

The structure is parsed sequentially:

```javascript
let offset = 0;

let columnCount = buffer.readInt32LE(offset);
offset += 4;

let columns = Array(columnCount);
let rows = [];

for (let i = 0; i < columnCount; i++) {
  columns[i] = buffer.readInt32LE(offset);
  offset += 4;
}

let rowCount = buffer.readInt32LE(offset);
offset += 4;
```

**Lines**: 4-18

---

## 6. Column Count

### Where: `lib/parser.js` line 6

```javascript
let columnCount = buffer.readInt32LE(offset);
offset += 4;
```

**Lines**: 6-7

**Format**: 
- **Type**: Signed 32-bit little-endian integer
- **Offset**: 0 (first 4 bytes)
- **Validation**: Must be 1-1000 (standard encryption) or 1-500 (plain format)

---

## 7. Column Types

### Where: `lib/parser.js` lines 9-15

```javascript
let columns = Array(columnCount);
let rows = [];

for (let i = 0; i < columnCount; i++) {
  columns[i] = buffer.readInt32LE(offset);
  offset += 4;
}
```

**Lines**: 9-15

**Format**:
- **Type**: Array of signed 32-bit little-endian integers
- **Offset**: 4 to (4 + columnCount * 4)
- **Count**: Exactly `columnCount` entries
- **Each entry**: 4 bytes

### Column Type Values

From `lib/reader.js` function `typeResolve` (lines 221-246):

```javascript
function typeResolve(n) {
  switch (n) {
    case 1:
      return "byte";
    case 2:
      return "ubyte";
    case 3:
      return "short";
    case 4:
      return "ushort";
    case 5:
      return "int";
    case 6:
      return "uint";
    case 7:
      return "str";
    case 8:
      return "float";
    case 9:
      return "double";
    case 10:
      return "long";
    case 11:
      return "ulong";
  }
}
```

**Lines**: 221-246

| Type ID | Name    | Size    | Parsed As                                    |
|---------|---------|---------|----------------------------------------------|
| 1       | byte    | 1 byte  | `readInt8`                                   |
| 2       | ubyte   | 1 byte  | `readUInt8`                                  |
| 3       | short   | 2 bytes | `readInt16LE`                                |
| 4       | ushort  | 2 bytes | `readUInt16LE`                               |
| 5       | int     | 4 bytes | `readInt32LE`                                |
| 6       | uint    | 4 bytes | `readUInt32LE`                               |
| 7       | str     | varies  | length-prefixed string (see below)          |
| 8       | float   | 4 bytes | `readFloatLE`                                |
| 9       | double  | 8 bytes | `readDoubleLE`                               |
| 10      | long    | 8 bytes | Two `readInt32LE` stored as array `[lo, hi]` |
| 11      | ulong   | 8 bytes | Two `readInt32LE` stored as array `[lo, hi]` |

---

## 8. Row Count

### Where: `lib/parser.js` line 17

```javascript
let rowCount = buffer.readInt32LE(offset);
offset += 4;
```

**Lines**: 17-18

**Format**:
- **Type**: Signed 32-bit little-endian integer
- **Offset**: 4 + (columnCount * 4)
- **Location**: Immediately after all column type definitions

---

## 9. String Data Storage

### Answer: Strings are INLINE and LENGTH-PREFIXED (NOT pooled, NOT offset-based)

### File: `lib/parser.js` lines 49-56

```javascript
case 7: {
  strlen = buffer.readInt32LE(offset);
  offset += 4;
  const s = buffer.slice(offset, offset + strlen);
  data.push(korean ? eucKR.decode(s) : s.toString("utf8"));
  offset += strlen;
  break;
}
```

**Lines**: 49-56

**String Format**:
```
[Length: 4 bytes, int32LE] [String Data: <length> bytes]
```

1. **Length prefix**: 4-byte signed 32-bit little-endian integer
2. **String data**: Immediately follows, exactly `length` bytes
3. **Encoding**: UTF-8 by default, or EUC-KR if `korean` parameter is true
4. **No null terminator**: The length determines the exact bytes to read
5. **Not pooled**: Each string is stored inline where it appears in the row data

**Assumption by repo author**: The length prefix includes all bytes of the string, and there is no separate string table or offset mechanism.

---

## 10. Row Data Structure

### File: `lib/parser.js` lines 21-77

```javascript
let strlen;
for (let i = 0; i < rowCount; i++) {
  let data = [];
  for (let c = 0; c < columnCount; c++) {
    switch (columns[c]) {
      case 1:
        data.push(buffer.readInt8(offset));
        offset++;
        break;
      case 2:
        data.push(buffer.readUInt8(offset));
        offset++;
        break;
      case 3:
        data.push(buffer.readInt16LE(offset));
        offset += 2;
        break;
      case 4:
        data.push(buffer.readUInt16LE(offset));
        offset += 2;
        break;
      case 5:
        data.push(buffer.readInt32LE(offset));
        offset += 4;
        break;
      case 6:
        data.push(buffer.readUInt32LE(offset));
        offset += 4;
        break;
      case 7: {
        strlen = buffer.readInt32LE(offset);
        offset += 4;
        const s = buffer.slice(offset, offset + strlen);
        data.push(korean ? eucKR.decode(s) : s.toString("utf8"));
        offset += strlen;
        break;
      }
      case 8:
        data.push(buffer.readFloatLE(offset));
        offset += 4;
        break;
      case 9:
        data.push(buffer.readDoubleLE(offset));
        offset += 8;
        break;
      case 10:
      case 11:
        data.push([
          buffer.readInt32LE(offset),
          buffer.readInt32LE(offset + 4),
        ]);
        offset += 8;
        break;
    }
  }

  rows.push(data);
}
```

**Lines**: 20-77

### Answer: Rows are SEQUENTIAL with VARIABLE SIZE (NOT fixed-size, NOT offset-based)

**Row Structure**:
- Rows are stored sequentially, one after another
- Each row contains exactly `columnCount` fields
- Fields are stored in the order defined by the `columns` array
- Each field's size depends on its type
- **No padding or alignment** between fields or rows
- Parser maintains an `offset` variable that advances through the buffer

**Example Row Layout** (if columns are [6, 7, 5]):
```
[uint: 4 bytes][length: 4 bytes][string data: <length> bytes][int: 4 bytes]
```

The next row starts immediately after, with the same structure.

---

## 11. Complete Control Flow with Code References

### Entry Point Flow:

#### 1. **CLI Invocation** (`bin/tblread.js`)
```bash
tblread Zones.tbl
# or
tblread -j Zones.tbl  # for JSON output
```

#### 2. **File Reading**
- **File**: `lib/reader.js` (UI mode) or `lib/reader_direct.js` (JSON mode)
- **Lines**: 43-52 or 8-16
- **Method**: `fse.readFile(file)` → returns Buffer

#### 3. **Encryption Detection & Decryption**
- **File**: `decryption/index.js`
- **Lines**: 5-20
- **Flow**:
  1. Try `standard.determine()` → if true, return `standard.decode()`
  2. Try `validCheck()` → if true, return buffer as-is (plain format)
  3. Otherwise, return empty array (unknown encryption)

##### 3a. **Standard Encryption Determination**
- **File**: `decryption/standard.js`
- **Function**: `determine` (lines 16-41)
- **Validates**: Column count (1-1000) and column types (0-11)

##### 3b. **Standard Encryption Decryption**
- **File**: `decryption/standard.js`
- **Function**: `decode` (lines 1-14)
- **Algorithm**: XOR with rolling key

##### 3c. **Plain Format Validation**
- **File**: `lib/valid_check.js`
- **Function**: `validCheck` (lines 1-13)
- **Validates**: Column count (≤500) and column types (1-8)

#### 4. **Parse Column Count**
- **File**: `lib/parser.js`
- **Lines**: 6-7
- **Offset**: 0
- **Format**: int32LE

#### 5. **Parse Column Types**
- **File**: `lib/parser.js`
- **Lines**: 9-15
- **Offset**: 4 to (4 + columnCount * 4)
- **Format**: Array of int32LE values

#### 6. **Parse Row Count**
- **File**: `lib/parser.js`
- **Lines**: 17-18
- **Offset**: 4 + (columnCount * 4)
- **Format**: int32LE

#### 7. **Parse Rows**
- **File**: `lib/parser.js`
- **Lines**: 20-77
- **Loop**: `rowCount` iterations
  - Inner loop: `columnCount` fields per row
  - Each field parsed according to its type from `columns` array
  - Strings are inline with 4-byte length prefix
  - Offset advances sequentially through buffer

#### 8. **Return Parsed Data**
- **File**: `lib/parser.js`
- **Lines**: 79-84
- **Returns**:
  ```javascript
  {
    rows,        // 2D array: rows[rowIndex][columnIndex]
    columns,     // Array of column type IDs
    columnCount, // Number of columns
    rowCount,    // Number of rows
  }
  ```

---

## 12. Format Detector (Optional Metadata)

### File: `lib/tbl_format_detector.js`
**Function**: `autoTBLFormatDetector` (lines 105-126)

This is **NOT part of the TBL format itself**. It's a helper that matches known column patterns to provide human-readable column names.

```javascript
exports.autoTBLFormatDetector = function (columns) {
  top: for (const u of KNOWN_FORMATS) {
    if (columns.length < u.columns.length) {
      continue top;
    }

    for (let i = 0; i < columns.length; i++) {
      if (u.columns[i] === undefined) {
        break;
      }

      if (u.columns[i] !== columns[i]) {
        continue top;
      }
    }

    return {
      file: u.file,
      desc: u.desc,
    };
  }
};
```

**Lines**: 105-126

The detector compares the parsed `columns` array against hardcoded patterns in `KNOWN_FORMATS` and returns descriptive names if a match is found. This is purely for display purposes and doesn't affect parsing.

---

## 13. Key Assumptions and Guesses by Repo Author

### Explicit Assumptions:

1. **Column Count Limits**:
   - Standard encryption: 1-1000 columns (`decryption/standard.js` line 29)
   - Plain format: ≤500 columns (`lib/valid_check.js` line 4)
   - **Assumption**: Real TBL files never exceed these limits

2. **Column Type Ranges**:
   - Standard encryption accepts types 0-11 (`decryption/standard.js` line 34)
   - Plain format validation only checks types 1-8 (`lib/valid_check.js` line 9)
   - **Assumption**: Plain format files don't use types 9-11

3. **String Encoding**:
   - Default: UTF-8 (`lib/parser.js` line 53)
   - Optional: EUC-KR for Korean files (`lib/parser.js` line 53)
   - **Assumption**: Files are either UTF-8 or EUC-KR, detected by user flag

4. **Long/ULong Representation**:
   - Stored as `[low32, high32]` array (`lib/parser.js` lines 66-71)
   - **Assumption**: JavaScript can't natively handle 64-bit integers accurately, so they're split

5. **Double Encryption Disabled**:
   - Code exists in `decryption/double.js` but is commented out in `decryption/index.js`
   - **Known issue**: "There is an issue with 1886 tbl files, decryption doesn't work right" (readme.md line 3)
   - **Assumption**: Double encryption exists but the implementation is incomplete/incorrect

6. **No Padding**:
   - Parser advances offset without any alignment or padding logic
   - **Assumption**: Fields are packed tightly with no padding bytes

7. **Sequential Reading**:
   - All data is read sequentially from start to end
   - **Assumption**: No random access, no footer, no index table

---

## 14. Summary Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Knight Online .TBL File Format                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Encrypted File (optional)                                    │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ XOR cipher with rolling key:                            │ │
│ │   key1 = 0x0816                                         │ │
│ │   byte_out = byte_in XOR (key1 >> 8)                    │ │
│ │   key1 = ((byte_in + key1) * 0x6081 + 0x1608) & 0xFFFF │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                          ↓ decryption
┌─────────────────────────────────────────────────────────────┐
│ Decrypted Buffer / Plain Format                              │
│                                                               │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ [0x00-0x03] Column Count (int32LE)                      │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ [0x04-...] Column Types (array of int32LE)              │ │
│ │   Type 1: byte (1 byte)                                 │ │
│ │   Type 2: ubyte (1 byte)                                │ │
│ │   Type 3: short (2 bytes)                               │ │
│ │   Type 4: ushort (2 bytes)                              │ │
│ │   Type 5: int (4 bytes)                                 │ │
│ │   Type 6: uint (4 bytes)                                │ │
│ │   Type 7: str (4-byte length + data)                    │ │
│ │   Type 8: float (4 bytes)                               │ │
│ │   Type 9: double (8 bytes)                              │ │
│ │   Type 10: long (8 bytes as [lo, hi])                   │ │
│ │   Type 11: ulong (8 bytes as [lo, hi])                  │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ [offset] Row Count (int32LE)                            │ │
│ │   offset = 4 + (columnCount * 4)                        │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ [offset] Row Data (sequential, variable-sized)          │ │
│ │   For each row:                                         │ │
│ │     For each column:                                    │ │
│ │       Read value based on column type                   │ │
│ │       If type 7 (string):                               │ │
│ │         [4 bytes: length]                               │ │
│ │         [length bytes: UTF-8 or EUC-KR string data]     │ │
│ │   No padding between fields or rows                     │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## 15. Code References Quick Index

| Component                | File                        | Lines   | Description                              |
|--------------------------|-----------------------------|---------|-----------------------------------------|
| CLI Entry                | `bin/tblread.js`            | 1-24    | Command-line interface                  |
| File Reading (UI)        | `lib/reader.js`             | 43-52   | Reads file into buffer                  |
| File Reading (JSON)      | `lib/reader_direct.js`      | 8-16    | Reads file into buffer                  |
| Decryption Dispatcher    | `decryption/index.js`       | 5-20    | Routes to correct decryption method     |
| Standard Determination   | `decryption/standard.js`    | 16-41   | Validates standard encryption           |
| Standard Decryption      | `decryption/standard.js`    | 1-14    | XOR decryption algorithm                |
| Plain Format Validation  | `lib/valid_check.js`        | 1-13    | Validates unencrypted files             |
| Parse Column Count       | `lib/parser.js`             | 6-7     | Reads columnCount at offset 0           |
| Parse Column Types       | `lib/parser.js`             | 9-15    | Reads column type array                 |
| Parse Row Count          | `lib/parser.js`             | 17-18   | Reads rowCount after column types       |
| Parse Rows               | `lib/parser.js`             | 20-77   | Iterates and parses all row data        |
| Parse String (Type 7)    | `lib/parser.js`             | 49-56   | Length-prefixed inline strings          |
| Type Resolution          | `lib/reader.js`             | 221-246 | Maps type IDs to names                  |
| Format Detector          | `lib/tbl_format_detector.js`| 105-126 | Matches known column patterns           |

---

## Conclusion

The Knight Online .TBL file format is a **binary, sequential, tightly-packed structure** with:

- **Optional encryption**: XOR cipher with rolling key (or plain)
- **Fixed header**: Column count, column types, row count
- **Variable-sized rows**: Sequential, no padding
- **Inline strings**: Length-prefixed, not pooled
- **Little-endian integers**: All multi-byte values
- **No random access**: Must parse sequentially from start

The repository makes several **assumptions** about limits and encodings, and the **double encryption support is incomplete**.
