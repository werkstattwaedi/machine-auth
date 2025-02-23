#pragma once

#include "libbase.h"

#define PN532_LOGTAG "PN532"

// Payload packet data to be sent from / to PN532.
//
// See https://files.waveshare.com/upload/b/bb/Pn532um.pdf
// 6.2 Host controller communication protocol
struct DataFrame {
  uint8_t command;
  uint8_t params[254];
  size_t params_length;
};

struct SelectedTag {
  uint8_t tg;
  size_t nfc_id_length;
  std::unique_ptr<uint8_t[]> nfc_id;
};

enum class PN532Error {
  kUnspecified = 0,
  kTimeout = 1,
  kEmptyResponse = 2,
  kNoTarget = 3,
  kFirmwareMismatch = 4,

};
class Ntag424;

// Communicates with a PN532 via UART.
class PN532 {
  friend Ntag424;

 public:
  // Constructs a new PN532 controller.
  //
  // Args:
  //   serial_interface: The interface on which the PN532 is connected.
  //   reset_pin: P2 pin connected to P70_IRQ's RSTPD_N pin.
  //   irq_pin: P2 pin connected to PN532's P70_IRQ pin.
  PN532(USARTSerial* serial_interface, uint8_t reset_pin, uint8_t irq_pin);

  // Initializes the PN532 controller.
  //
  // Initializes the P2 hardware configuration (pinmodes, serial interface),
  // resets the PN532 and configures it for Initiator / PCD mode.
  tl::expected<void, PN532Error> Begin();

  // Waits for a single ISO/IEC14443 Type A tag to be detected.
  tl::expected<std::shared_ptr<SelectedTag>, PN532Error> WaitForNewTag(
      system_tick_t timeout_ms = CONCURRENT_WAIT_FOREVER);

  // Check whether previously selected tag is still available.
  tl::expected<bool, PN532Error> CheckTagStillAvailable(
      std::shared_ptr<SelectedTag> tag);

  tl::expected<void, PN532Error> ReleaseTag(std::shared_ptr<SelectedTag> tag);

  // Resets the PN532 via reset_pin_, then wakes it up and configures
  // it as PCD
  tl::expected<void, PN532Error> ResetController();

 private:
  // Sends the command_data payload to the PN532.
  //
  // This function blocks until the data is transmitted and the command is
  // ACK'ed on a data link level. "retries" re-transmitting if not ACK'ed
  //
  // Args:
  //   command_data: The DataFrame to send.
  //   retries: Number of retries in case of a communication error.
  tl::expected<void, PN532Error> SendCommand(DataFrame* command_data,
                                             int retries = 3);

  // Receives the response_data payload from the PN532.
  //
  // This function blocks until the data is received.
  //
  // Args:
  //   response_data: The DataFrame into which to put the received data.
  //   timeout_ms: Timeout to wait for trasmission start.
  //   retries: Number of retries in case of a communication error.
  tl::expected<void, PN532Error> ReceiveResponse(
      DataFrame* response_data,
      system_tick_t timeout_ms = CONCURRENT_WAIT_FOREVER, int retries = 3);

  // Sends the command and waits for the response.
  //
  // The response data will be put in command_in_response_out.
  // This function blocks until the data is received.
  //
  // Args:
  //   command_in_response_out: The in/out DataFrame .
  //   timeout_ms: Timeout to wait for trasmission start.
  //   retries: Number of retries in case of a communication error.
  tl::expected<void, PN532Error> CallFunction(
      DataFrame* command_in_response_out,
      system_tick_t timeout_ms = CONCURRENT_WAIT_FOREVER, int retries = 3);

 private:
  static Logger logger;
  bool is_initialized_;
  USARTSerial* serial_interface_;
  int8_t irq_pin_;
  int8_t reset_pin_;
  os_semaphore_t response_available_;
  system_tick_t command_timeout_ms_;

  // Verified the communication and checks the expected response to
  // GetFirmwareVersion
  tl::expected<void, PN532Error> CheckControllerFirmware();

  // Sends the command_data payload to the PN532.
  tl::expected<void, PN532Error> WriteFrame(DataFrame* command_data);
  // Reads a response from the PN532, blocks until the data is received.
  tl::expected<void, PN532Error> ReadFrame(DataFrame* response_data);
  // Reads the ACK response from the PN532.
  tl::expected<void, PN532Error> ReadAckFrame();
  // Reads and discards input until frame start sequence 0x00 0xFF is received.
  tl::expected<void, PN532Error> ConsumeFrameStartSequence();
  // ISR handler for irq_pin_, signals response_available_
  void ResponseAvailableInterruptHandler();

  int ReadByte() { return ReadByteWithTimeout(command_timeout_ms_); }
  bool AwaitBytesWithDeadline(int awaited_bytes, system_tick_t deadline);
  int ReadByteWithDeadline(system_tick_t deadline);
  int ReadByteWithTimeout(system_tick_t timeout_ms = CONCURRENT_WAIT_FOREVER);
};

#define PN532_PREAMBLE (0x00)    ///< Command sequence start, byte 1/3
#define PN532_STARTCODE1 (0x00)  ///< Command sequence start, byte 2/3
#define PN532_STARTCODE2 (0xFF)  ///< Command sequence start, byte 3/3
#define PN532_POSTAMBLE (0x00)   ///< EOD

#define PN532_HOSTTOPN532 (0xD4)  ///< Host-to-PN532
#define PN532_PN532TOHOST (0xD5)  ///< PN532-to-host

// PN532 Commands
#define PN532_COMMAND_DIAGNOSE (0x00)               ///< Diagnose
#define PN532_COMMAND_GETFIRMWAREVERSION (0x02)     ///< Get firmware version
#define PN532_COMMAND_GETGENERALSTATUS (0x04)       ///< Get general status
#define PN532_COMMAND_READREGISTER (0x06)           ///< Read register
#define PN532_COMMAND_WRITEREGISTER (0x08)          ///< Write register
#define PN532_COMMAND_READGPIO (0x0C)               ///< Read GPIO
#define PN532_COMMAND_WRITEGPIO (0x0E)              ///< Write GPIO
#define PN532_COMMAND_SETSERIALBAUDRATE (0x10)      ///< Set serial baud rate
#define PN532_COMMAND_SETPARAMETERS (0x12)          ///< Set parameters
#define PN532_COMMAND_SAMCONFIGURATION (0x14)       ///< SAM configuration
#define PN532_COMMAND_POWERDOWN (0x16)              ///< Power down
#define PN532_COMMAND_RFCONFIGURATION (0x32)        ///< RF config
#define PN532_COMMAND_RFREGULATIONTEST (0x58)       ///< RF regulation test
#define PN532_COMMAND_INJUMPFORDEP (0x56)           ///< Jump for DEP
#define PN532_COMMAND_INJUMPFORPSL (0x46)           ///< Jump for PSL
#define PN532_COMMAND_INLISTPASSIVETARGET (0x4A)    ///< List passive target
#define PN532_COMMAND_INATR (0x50)                  ///< ATR
#define PN532_COMMAND_INPSL (0x4E)                  ///< PSL
#define PN532_COMMAND_INDATAEXCHANGE (0x40)         ///< Data exchange
#define PN532_COMMAND_INCOMMUNICATETHRU (0x42)      ///< Communicate through
#define PN532_COMMAND_INDESELECT (0x44)             ///< Deselect
#define PN532_COMMAND_INRELEASE (0x52)              ///< Release
#define PN532_COMMAND_INSELECT (0x54)               ///< Select
#define PN532_COMMAND_INAUTOPOLL (0x60)             ///< Auto poll
#define PN532_COMMAND_TGINITASTARGET (0x8C)         ///< Init as target
#define PN532_COMMAND_TGSETGENERALBYTES (0x92)      ///< Set general bytes
#define PN532_COMMAND_TGGETDATA (0x86)              ///< Get data
#define PN532_COMMAND_TGSETDATA (0x8E)              ///< Set data
#define PN532_COMMAND_TGSETMETADATA (0x94)          ///< Set metadata
#define PN532_COMMAND_TGGETINITIATORCOMMAND (0x88)  ///< Get initiator command
#define PN532_COMMAND_TGRESPONSETOINITIATOR (0x90)  ///< Response to initiator
#define PN532_COMMAND_TGGETTARGETSTATUS (0x8A)      ///< Get target status

#define PN532_RESPONSE_INDATAEXCHANGE (0x41)       ///< Data exchange
#define PN532_RESPONSE_INLISTPASSIVETARGET (0x4B)  ///< List passive target

#define PN532_WAKEUP (0x55)  ///< Wake

#define PN532_SPI_STATREAD (0x02)   ///< Stat read
#define PN532_SPI_DATAWRITE (0x01)  ///< Data write
#define PN532_SPI_DATAREAD (0x03)   ///< Data read
#define PN532_SPI_READY (0x01)      ///< Ready

#define PN532_I2C_ADDRESS (0x48 >> 1)  ///< Default I2C address
#define PN532_I2C_READBIT (0x01)       ///< Read bit
#define PN532_I2C_BUSY (0x00)          ///< Busy
#define PN532_I2C_READY (0x01)         ///< Ready
#define PN532_I2C_READYTIMEOUT (20)    ///< Ready timeout

#define PN532_MIFARE_ISO14443A (0x00)  ///< MiFare

// NTAG242 Commands
#define NTAG424_COMM_MODE_PLAIN (0x00)         ///< Commmode plain
#define NTAG424_COMM_MODE_MAC (0x01)           ///< Commmode mac
#define NTAG424_COMM_MODE_FULL (0x02)          ///< Commmode full
#define NTAG424_COM_CLA (0x90)                 ///< CLA prefix
#define NTAG424_COM_CHANGEKEY (0xC4)           ///< changekey
#define NTAG424_CMD_READSIG (0x3C)             ///< Read_Sig
#define NTAG424_CMD_GETTTSTATUS (0xF7)         ///< getttstatus
#define NTAG424_CMD_GETFILESETTINGS (0xF5)     ///< getfilesettings
#define NTAG424_CMD_CHANGEFILESETTINGS (0x5F)  ///< changefilesettings
#define NTAG424_CMD_GETCARDUUID (0x51)         ///< getfilesettings
#define NTAG424_CMD_READDATA (0xAD)            ///< Readdata
#define NTAG424_CMD_GETVERSION (0x60)          ///< GetVersion
#define NTAG424_CMD_NEXTFRAME (0xAF)           ///< Nextframe

#define NTAG424_RESPONE_GETVERSION_HWTYPE_NTAG424 \
  (0x04)  ///< Response value HWType NTAG 424

#define NTAG424_COM_ISOCLA (0x00)           ///< ISO prefix
#define NTAG424_CMD_ISOSELECTFILE (0xA4)    ///< ISOSelectFile
#define NTAG424_CMD_ISOREADBINARY (0xB0)    ///< ISOReadBinary
#define NTAG424_CMD_ISOUPDATEBINARY (0xD6)  ///< ISOUpdateBinary

// Mifare Commands
#define MIFARE_CMD_AUTH_A (0x60)            ///< Auth A
#define MIFARE_CMD_AUTH_B (0x61)            ///< Auth B
#define MIFARE_CMD_READ (0x30)              ///< Read
#define MIFARE_CMD_WRITE (0xA0)             ///< Write
#define MIFARE_CMD_TRANSFER (0xB0)          ///< Transfer
#define MIFARE_CMD_DECREMENT (0xC0)         ///< Decrement
#define MIFARE_CMD_INCREMENT (0xC1)         ///< Increment
#define MIFARE_CMD_STORE (0xC2)             ///< Store
#define MIFARE_ULTRALIGHT_CMD_WRITE (0xA2)  ///< Write (MiFare Ultralight)

// Prefixes for NDEF Records (to identify record type)
#define NDEF_URIPREFIX_NONE (0x00)          ///< No prefix
#define NDEF_URIPREFIX_HTTP_WWWDOT (0x01)   ///< HTTP www. prefix
#define NDEF_URIPREFIX_HTTPS_WWWDOT (0x02)  ///< HTTPS www. prefix
#define NDEF_URIPREFIX_HTTP (0x03)          ///< HTTP prefix
#define NDEF_URIPREFIX_HTTPS (0x04)         ///< HTTPS prefix
#define NDEF_URIPREFIX_TEL (0x05)           ///< Tel prefix
#define NDEF_URIPREFIX_MAILTO (0x06)        ///< Mailto prefix
#define NDEF_URIPREFIX_FTP_ANONAT (0x07)    ///< FTP
#define NDEF_URIPREFIX_FTP_FTPDOT (0x08)    ///< FTP dot
#define NDEF_URIPREFIX_FTPS (0x09)          ///< FTPS
#define NDEF_URIPREFIX_SFTP (0x0A)          ///< SFTP
#define NDEF_URIPREFIX_SMB (0x0B)           ///< SMB
#define NDEF_URIPREFIX_NFS (0x0C)           ///< NFS
#define NDEF_URIPREFIX_FTP (0x0D)           ///< FTP
#define NDEF_URIPREFIX_DAV (0x0E)           ///< DAV
#define NDEF_URIPREFIX_NEWS (0x0F)          ///< NEWS
#define NDEF_URIPREFIX_TELNET (0x10)        ///< Telnet prefix
#define NDEF_URIPREFIX_IMAP (0x11)          ///< IMAP prefix
#define NDEF_URIPREFIX_RTSP (0x12)          ///< RTSP
#define NDEF_URIPREFIX_URN (0x13)           ///< URN
#define NDEF_URIPREFIX_POP (0x14)           ///< POP
#define NDEF_URIPREFIX_SIP (0x15)           ///< SIP
#define NDEF_URIPREFIX_SIPS (0x16)          ///< SIPS
#define NDEF_URIPREFIX_TFTP (0x17)          ///< TFPT
#define NDEF_URIPREFIX_BTSPP (0x18)         ///< BTSPP
#define NDEF_URIPREFIX_BTL2CAP (0x19)       ///< BTL2CAP
#define NDEF_URIPREFIX_BTGOEP (0x1A)        ///< BTGOEP
#define NDEF_URIPREFIX_TCPOBEX (0x1B)       ///< TCPOBEX
#define NDEF_URIPREFIX_IRDAOBEX (0x1C)      ///< IRDAOBEX
#define NDEF_URIPREFIX_FILE (0x1D)          ///< File
#define NDEF_URIPREFIX_URN_EPC_ID (0x1E)    ///< URN EPC ID
#define NDEF_URIPREFIX_URN_EPC_TAG (0x1F)   ///< URN EPC tag
#define NDEF_URIPREFIX_URN_EPC_PAT (0x20)   ///< URN EPC pat
#define NDEF_URIPREFIX_URN_EPC_RAW (0x21)   ///< URN EPC raw
#define NDEF_URIPREFIX_URN_EPC (0x22)       ///< URN EPC
#define NDEF_URIPREFIX_URN_NFC (0x23)       ///< URN NFC

#define PN532_GPIO_VALIDATIONBIT (0x80)  ///< GPIO validation bit
#define PN532_GPIO_P30 (0)               ///< GPIO 30
#define PN532_GPIO_P31 (1)               ///< GPIO 31
#define PN532_GPIO_P32 (2)               ///< GPIO 32
#define PN532_GPIO_P33 (3)               ///< GPIO 33
#define PN532_GPIO_P34 (4)               ///< GPIO 34
#define PN532_GPIO_P35 (5)               ///< GPIO 35
