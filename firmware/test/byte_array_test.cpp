#include "common/byte_array.h"

#include "Particle.h"

void hexDump(const char *desc, void *addr, int len);

int main(int argc, char *argv[]) {
  // MakeBytesFromHexString
  {
    auto src = std::string("112233");
    unsigned char expected[]{0x11, 0x22, 0x33};
    auto result = MakeBytesFromHexString<3>(src);

    assert(result.has_value());

    hexDump("parsed 3 bytes", result.value().data(), 3);

    assert(memcmp(result.value().data(), expected, 3) == 0);
  }
  // MakeBytesFromHexString wrong number of bytes does not parse
  {
    auto src = std::string("112233");
    auto result = MakeBytesFromHexString<4>(src);

    assert(!result.has_value());
  }
  // MakeBytesFromHexString uneven number does not parse
  {
    auto src = std::string("1");
    auto result = MakeBytesFromHexString<1>(src);

    assert(!result.has_value());
  }
  // MakeBytesFromHexString characters
  {
    auto src = std::string("123456789abcdef0ABCDEF");
    auto result = MakeBytesFromHexString<11>(src);

    assert(result.has_value());
    hexDump("all characters", result.value().data(), 11);

    auto expected = MakeBytes(0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0,
                              0xab, 0xcd, 0xef);

    assert(memcmp(result.value().data(), expected.data(), 11) == 0);
  }
  // MakeBytesFromHexString unsupported charatcer
  {
    auto src = std::string("gf");
    auto result = MakeBytesFromHexString<1>(src);

    assert(!result.has_value());
  }
  // ToHexString
  {
    std::array<std::byte, 4> src = MakeBytes(0x00, 0x12, 0xab, 0xff);

    auto result = ToHexString(src);

    assert(result == "0012abff");
  }
}

void hexDump(const char *desc, void *addr, int len) {
  int i;
  unsigned char buff[17];
  unsigned char *pc = (unsigned char *)addr;

  // Output description if given.
  if (desc != NULL) printf("%s:\n", desc);

  // Process every byte in the data.
  for (i = 0; i < len; i++) {
    // Multiple of 16 means new line (with line offset).

    if ((i % 16) == 0) {
      // Just don't print ASCII for the zeroth line.
      if (i != 0) printf("  %s\n", buff);

      // Output the offset.
      printf("  %04x ", i);
    }

    // Now the hex code for the specific character.
    printf(" %02x", pc[i]);

    // And store a printable ASCII character for later.
    if ((pc[i] < 0x20) || (pc[i] > 0x7e)) {
      buff[i % 16] = '.';
    } else {
      buff[i % 16] = pc[i];
    }

    buff[(i % 16) + 1] = '\0';
  }

  // Pad out last line if not exactly 16 characters.
  while ((i % 16) != 0) {
    printf("   ");
    i++;
  }

  // And print the final ASCII bit.
  printf("  %s\n", buff);
}