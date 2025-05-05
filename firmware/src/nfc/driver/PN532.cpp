
#include "PN532.h"

Logger PN532::logger("pn532");

#define PN532_FRAME_MAX_LENGTH 255
#define PN532_DEFAULT_TIMEOUT 1000

const uint8_t PN532_ACK[] = {0x00, 0x00, 0xFF, 0x00, 0xFF, 0x00};
const uint8_t PN532_NACK[] = {0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00};
const uint8_t PN532_FRAME_START[] = {PN532_PREAMBLE, PN532_STARTCODE1,
                                     PN532_STARTCODE2};
// PN532, V1.6
const uint8_t PN532_FIRMWARE_RESPONSE[] = {0x32, 0x01, 0x06, 0x07};

PN532::PN532(USARTSerial* serialInterface, uint8_t resetPin, uint8_t irqPin)
    : is_initialized_(false),
      serial_interface_(serialInterface),
      irq_pin_(irqPin),
      reset_pin_(resetPin) {}

tl::expected<void, PN532Error> PN532::Begin() {
  if (is_initialized_) {
    logger.error("PN532::Begin() Already initialized");
    return tl::unexpected(PN532Error::kUnspecified);
  }
  is_initialized_ = true;

  logger.info("PN532::Begin [interface:%d, irq:%d, reset:%d]",
              serial_interface_->interface(), irq_pin_, reset_pin_);

  os_semaphore_create(&response_available_, 1, 0);

  pinMode(reset_pin_, OUTPUT);
  digitalWrite(reset_pin_, HIGH);

  pinMode(irq_pin_, INPUT);
  attachInterrupt(irq_pin_, &PN532::ResponseAvailableInterruptHandler, this,
                  FALLING);

  serial_interface_->begin(115200);

  // 6.2.2 Dialog structure - timeout is 89ms at 115200 baud
  command_timeout_ms_ = 89;
  serial_interface_->setTimeout(command_timeout_ms_);

  return ResetController();
}

tl::expected<std::shared_ptr<SelectedTag>, PN532Error> PN532::WaitForNewTag(
    system_tick_t timeout_ms) {
  // MaxTg is the maximum number of targets to be initialized by the PN532.
  // The PN532 is capable of handling 2 targets maximum at once, so this field
  // should not exceed 0x02
  uint8_t max_tg = 1;

  // BrTy is the baud rate and the modulation type to be used during the
  // initialization. 0x00 is 106 kbps type A (ISO/IEC14443 Type A),
  uint8_t br_ty = 0x00;

  DataFrame list_passive_target{.command = PN532_COMMAND_INLISTPASSIVETARGET,
                                .params =
                                    {
                                        max_tg,
                                        br_ty,
                                    },
                                .params_length = 2};

  auto call_function = CallFunction(&list_passive_target, timeout_ms, 1);
  if (!call_function) {
    logger.error("WaitForTag InListPassiveTarget failed");
    return tl::unexpected(call_function.error());
  }

  if (list_passive_target.params_length <= 0) {
    logger.error("WaitForTag InListPassiveTarget response empty");
    return tl::unexpected(PN532Error::kEmptyResponse);
  }

  uint8_t number_targets = list_passive_target.params[0];
  if (number_targets == 0) {
    return tl::unexpected(PN532Error::kNoTarget);
  }

  // Only interested in tg ID and NFC ID
  uint8_t tg = list_passive_target.params[1];

  size_t nfc_id_length = list_passive_target.params[5];

  auto result = std::shared_ptr<SelectedTag>{
      new SelectedTag{.tg = tg, .nfc_id_length = nfc_id_length}};

  std::memcpy(result->nfc_id.data(), std::begin(list_passive_target.params) + 6,
              nfc_id_length);

  return {result};
}

tl::expected<bool, PN532Error> PN532::CheckTagStillAvailable() {
  //  NumTst = 0x06 : Attention Request Test or ISO/IEC14443-4 card presence
  //  detection

  uint8_t num_tst = 0x06;

  DataFrame diagnose{.command = PN532_COMMAND_DIAGNOSE,
                     .params =
                         {
                             num_tst,
                         },
                     .params_length = 1};

  auto call_function = CallFunction(&diagnose, 100, 1);
  if (!call_function) {
    logger.error("CheckTagStillAvailable Diagnose failed");
    return tl::unexpected(call_function.error());
  }

  if (diagnose.params_length != 1) {
    logger.error("CheckTagStillAvailable Diagnose response wrong length");
    return tl::unexpected(PN532Error::kEmptyResponse);
  }

  uint8_t result = diagnose.params[0];

  if (result != 0x00) {
    // see "7.1 Error handling"
    // ../docs/datasheets/Pn532um.pdf#page=67

    logger.error("card presence failed, code %d", result);
    return {false};
  }

  return {true};
}

tl::expected<void, PN532Error> PN532::ReleaseTag(
    std::shared_ptr<SelectedTag> tag) {
  DataFrame release{.command = PN532_COMMAND_INRELEASE,
                    .params = {tag->tg},
                    .params_length = 1};

  auto call_function = CallFunction(&release);
  if (!call_function) {
    logger.error("WaitForTag InRelease failed");
    return tl::unexpected(call_function.error());
  }

  return {};
}

tl::expected<void, PN532Error> PN532::SendCommand(DataFrame* command_data,
                                                  int retries) {
  auto write_frame = WriteFrame(command_data);
  if (!write_frame) {
    return write_frame;
  }

  auto read_ack_frame = ReadAckFrame();
  // logger.trace("Got Ack");
  if (!read_ack_frame) {
    if (retries > 0) {
      logger.warn("PN532::SendCommand failed to receive ACK, retrying...");
      return SendCommand(command_data, retries - 1);
    } else {
      logger.error("PN532::SendCommand failed to receive ACK");
      return read_ack_frame;
    }
  }

  return {};
}

tl::expected<void, PN532Error> PN532::ReceiveResponse(DataFrame* response_data,
                                                      system_tick_t timeout_ms,
                                                      int retries) {
  uint32_t tickstart = millis();
  while (true) {
    auto consume_start_sequence = ConsumeFrameStartSequence();
    if (consume_start_sequence.has_value()) {
      break;
    }

    if (consume_start_sequence.error() != PN532Error::kTimeout) {
      return consume_start_sequence;
    }

    delay(5);
    if (millis() - tickstart > timeout_ms) {
      return tl::unexpected(PN532Error::kTimeout);
    }
  }

  auto read_frame = ReadFrame(response_data);
  if (!read_frame) {
    if (retries > 0) {
      logger.warn(
          "ReceiveResponse did not receive frame, retrying with NACK...");
      serial_interface_->write(PN532_NACK, sizeof(PN532_NACK));
      return ReceiveResponse(response_data, timeout_ms, retries - 1);
    } else {
      logger.error("ReceiveResponse did not receive correct frame.");
      return read_frame;
    }
  }

  return {};
}

tl::expected<void, PN532Error> PN532::CallFunction(
    DataFrame* command_in_response_out, system_tick_t timeout_ms, int retries) {
  auto send_command = SendCommand(command_in_response_out, retries);
  if (!send_command) {
    logger.error("CallFunction SendCommand failed");
    return send_command;
  }

  auto receive_response =
      ReceiveResponse(command_in_response_out, timeout_ms, retries);
  if (!receive_response) {
    logger.error("CallFunction ReceiveResponse failed (error: %d)",
                 (int)receive_response.error());
    if (receive_response.error() == PN532Error::kTimeout) {
      // see "6.2.2.1 Data link level", section "d) Abort"
      // When receiving the response timed out, send ACK to abort
      serial_interface_->write(PN532_ACK, sizeof(PN532_ACK));
    }

    return receive_response;
  }

  return {};
}

tl::expected<void, PN532Error> PN532::ResetController() {
  logger.info("PN532::ResetController");

  digitalWrite(reset_pin_, LOW);
  // 100us should be enough to reset, RSTOUT would indicate that PN532 is
  // actually reset. Since this is not wired, wait for 10ms, that should do the
  // trick.
  delay(10);
  digitalWrite(reset_pin_, HIGH);
  delay(10);

  // 6.3.2.3 Case of PN532 in Power Down mode
  // HSU wake up condition: the real waking up condition is the 5th rising edge
  // on the serial line, hence send first a 0x55 dummy byte and wait for the
  // waking up delay before sending the command frame.
  serial_interface_->write(PN532_WAKEUP);

  // the host controller has to wait for at least T_osc_start before sending a
  // new command that will be properly understood. T_osc_start is typically a
  // few 100µs, but depending of the quartz, board layout and capacitors, it can
  // be up to 2ms
  delay(2);

  // After reset, SAMConfiguration must be executed as a first command
  // https://files.waveshare.com/upload/b/bb/Pn532um.pdf
  // see p89
  DataFrame sam_configuration{
      .command = PN532_COMMAND_SAMCONFIGURATION,
      .params =
          {
              0x01,  // normal mode
              0x14,  // 0x14, timeout 50ms * 20 = 1 second
              0x01,  // use IRQ pin!
          },
      .params_length = 3};

  auto call_function = CallFunction(&sam_configuration);
  if (!call_function) {
    logger.error("ResetController SAMConfiguration failed");
    return call_function;
  }

  return CheckControllerFirmware();
}

tl::expected<void, PN532Error> PN532::CheckControllerFirmware() {
  DataFrame get_firmware_version{.command = PN532_COMMAND_GETFIRMWAREVERSION,
                                 .params_length = 0};

  auto send_command = CallFunction(&get_firmware_version);
  if (!send_command) {
    logger.error("CheckControllerFirmware failed");
    return send_command;
  }

  if (get_firmware_version.params_length != sizeof(PN532_FIRMWARE_RESPONSE) ||
      memcmp(get_firmware_version.params, PN532_FIRMWARE_RESPONSE,
             sizeof(PN532_FIRMWARE_RESPONSE)) != 0) {
    logger.error("Firmware doesn't match!");
    return tl::unexpected(PN532Error::kFirmwareMismatch);
  }

  return {};
}

tl::expected<void, PN532Error> PN532::WriteFrame(DataFrame* command_data) {
  // packet data length includes the TFI byte, hence + 1
  size_t length = command_data->params_length + 2;
  if (length > PN532_FRAME_MAX_LENGTH) {
    logger.error("command_data packet is too long (%d bytes)", length);
    return tl::unexpected(PN532Error::kUnspecified);
  }

  // See https://files.waveshare.com/upload/b/bb/Pn532um.pdf
  // 6.2 Host controller communication protocol

  // [Byte 0..2] Frame start
  serial_interface_->write(PN532_FRAME_START, sizeof(PN532_FRAME_START));

  // [Byte 3] Command length (includes TFI, hence + 1)
  serial_interface_->write(length);

  // [Byte 4] Command length checksum
  serial_interface_->write(~length + 1);

  // Data starting from here is included in the checksum.
  // [Byte 5] Frame identifier
  serial_interface_->write(PN532_HOSTTOPN532);
  serial_interface_->write(command_data->command);
  // [Bytes 6..n] packet data
  serial_interface_->write(command_data->params, command_data->params_length);

  uint8_t checksum = PN532_HOSTTOPN532 + command_data->command;
  for (uint8_t i = 0; i < command_data->params_length; i++) {
    checksum += command_data->params[i];
  }

  // [Byte n+1] checksum
  serial_interface_->write(~checksum + 1);
  // [Byte n+2] postamble
  serial_interface_->write(PN532_POSTAMBLE);

  serial_interface_->flush();

  if (logger.isTraceEnabled()) {
    logger.trace(
        "WriteFrame(%#04x)[%s]", command_data->command,
        BytesToHexString(command_data->params, command_data->params_length)
            .c_str());
  }

  return {};
}

int PN532::ReadByteWithDeadline(system_tick_t deadline) {
  do {
    int c = serial_interface_->read();
    if (c >= 0) return c;
  } while (millis() < deadline);
  return -1;  // -1 indicates timeout
}

bool PN532::AwaitBytesWithDeadline(int awaited_bytes, system_tick_t deadline) {
  do {
    if (serial_interface_->available() >= awaited_bytes) return true;
  } while (millis() < deadline);
  return false;
}

int PN532::ReadByteWithTimeout(system_tick_t timeout_ms) {
  int c;
  auto startMillis = millis();
  do {
    c = serial_interface_->read();
    if (c >= 0) return c;
  } while (millis() - startMillis < timeout_ms);
  return -1;  // -1 indicates timeout
}

tl::expected<void, PN532Error> PN532::ReadFrame(DataFrame* response_data) {
  // See https://files.waveshare.com/upload/b/bb/Pn532um.pdf
  // 6.2 Host controller communication protocol
  // logger.trace("Start ReadFrame");

  auto deadline = millis() + command_timeout_ms_;
  if (!AwaitBytesWithDeadline(4, deadline)) {
    return tl::unexpected(PN532Error::kTimeout);
  }

  uint8_t frame_length = serial_interface_->read();
  uint8_t frame_length_checksum = serial_interface_->read();
  if (((frame_length + frame_length_checksum) & 0xFF) != 0) {
    logger.error("Response length checksum did not match length!");
    return tl::unexpected(PN532Error::kUnspecified);
  }
  // Check TFI byte matches.
  uint8_t frame_identifier = serial_interface_->read();
  if (frame_identifier != PN532_PN532TOHOST) {
    logger.error("TFI byte (%#04x) did not match expected value",
                 frame_identifier);
    return tl::unexpected(PN532Error::kUnspecified);
  }

  // Check response command matches
  uint8_t response_command = serial_interface_->read();
  uint8_t expected_response = response_data->command + 1;
  if (response_command != expected_response) {
    logger.error(
        "response_command (%#04x) did not match expected command (%#04x)",
        response_command, expected_response);
    return tl::unexpected(PN532Error::kUnspecified);
  }

  // Read frame with expected length of data. Note:
  // - TFI byte and response_command was already consumed above.
  // - response_data's packetData is big enough to contain the maximal
  // frame_length
  response_data->params_length = frame_length - 2;
  size_t bytes_read = serial_interface_->readBytes(
      (char*)response_data->params, response_data->params_length);
  if (bytes_read != response_data->params_length) {
    logger.error(
        "Response stream tearminated early. Read %d bytes, expected %d",
        bytes_read, response_data->params_length);
    return tl::unexpected(PN532Error::kUnspecified);
  }

  if (logger.isTraceEnabled()) {
    logger.trace(
        "ReadFrame(%#04x)[%s]", response_command,
        BytesToHexString(response_data->params, response_data->params_length)
            .c_str());
  }

  uint8_t checksum = frame_identifier + response_command;
  // Check frame checksum value matches bytes.
  for (uint8_t i = 0; i < response_data->params_length; i++) {
    checksum += response_data->params[i];
  }

  // Add last "Data checksum byte".
  int checksum_byte = ReadByteWithDeadline(deadline);
  if (checksum_byte < 0) {
    return tl::unexpected(PN532Error::kTimeout);
  }
  if (((checksum + checksum_byte) & 0xff) != 0) {
    logger.error("Response checksum did not match expected checksum");
    return tl::unexpected(PN532Error::kUnspecified);
  }

  return {};
}

tl::expected<void, PN532Error> PN532::ReadAckFrame() {
  // See https://files.waveshare.com/upload/b/bb/Pn532um.pdf
  // 6.2.1.3 ACK frame
  // This is essentially an empty frame, with a data LEN 0
  auto deadline = millis() + command_timeout_ms_;

  auto consume_start_sequence = ConsumeFrameStartSequence();
  if (!consume_start_sequence) {
    logger.error("ACK frame deadline 1");
    return consume_start_sequence;
  }

  if (!AwaitBytesWithDeadline(2, deadline)) {
    return tl::unexpected(PN532Error::kTimeout);
  }

  int frame_length = serial_interface_->read();
  if (frame_length != 0) {
    logger.error("ACK frame must be 0 length");
    return tl::unexpected(PN532Error::kUnspecified);
  }

  int frame_length_checksum = serial_interface_->read();
  if (frame_length_checksum != 0xff) {
    logger.error("ACK frame length checksum invalid");
    return tl::unexpected(PN532Error::kUnspecified);
  }

  return {};
}

tl::expected<void, PN532Error> PN532::ConsumeFrameStartSequence() {
  // Skip reading until start sequence 0x00 0xFF is received.
  auto deadline = millis() + command_timeout_ms_;

  if (!AwaitBytesWithDeadline(2, deadline)) {
    return tl::unexpected(PN532Error::kTimeout);
  }

  int start_1 = serial_interface_->read();
  int start_2 = serial_interface_->read();

  uint8_t skipped_count = 0;
  while (start_1 != PN532_STARTCODE1 || start_2 != PN532_STARTCODE2) {
    start_1 = start_2;
    start_2 = ReadByteWithDeadline(deadline);
    if (start_2 < 0) {
      return tl::unexpected(PN532Error::kTimeout);
    }

    skipped_count++;
    if (skipped_count > PN532_FRAME_MAX_LENGTH) {
      logger.error("Response frame preamble does not contain 0x00FF!");
      return tl::unexpected(PN532Error::kUnspecified);
    }
  }

  return {};
}

void PN532::ResponseAvailableInterruptHandler() {
  os_semaphore_give(response_available_, false);
}