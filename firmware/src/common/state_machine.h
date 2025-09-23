#pragma once

#include <functional>
#include <optional>
#include <tuple>

#include "common.h"

namespace oww::common {

template <typename... States>
class StateMachine;

template <typename... States>
class StateHandle;

template <typename... States>
class StateQuery {
 public:
  using State = typename StateMachine<States...>::State;

  StateQuery(std::function<bool(const State&)> fn) : fn_(fn) {}

  bool Matches(const StateMachine<States...>& sm) const {
    return fn_(sm.GetState());
  }

  bool Matches(const StateHandle<States...>& handle) const {
    if (auto sm = handle.state_machine_.lock()) {
      return fn_(sm->GetState());
    }
    return false;
  }

 private:
  std::function<bool(const State&)> fn_;
};

template <typename... States>
class StateHandle {
  friend class StateMachine<States...>;
  friend class StateQuery<States...>;

 public:
  bool IsNew() const { return !previous_state_; }

  template <typename T>
  bool Is() const {
    if (auto sm = state_machine_.lock()) {
      return std::holds_alternative<T>(*sm->get_state_ptr());
    }
    return false;
  }

  template <typename T>
  bool Entered() const {
    if (auto sm = state_machine_.lock()) {
      return Is<T>() &&
             (!previous_state_ || !std::holds_alternative<T>(*previous_state_));
    }
    return false;
  }

  template <typename T>
  bool Exited() const {
    if (auto sm = state_machine_.lock()) {
      return !Is<T>() &&
             (previous_state_ && std::holds_alternative<T>(*previous_state_));
    }
    return false;
  }

  template <typename T>
  const T* Get() const {
    if (auto sm = state_machine_.lock()) {
      return std::get_if<T>(sm->get_state_ptr().get());
    }
    return nullptr;
  }

 private:
  StateHandle(std::shared_ptr<const std::variant<States...>> previous_state,
              std::weak_ptr<const StateMachine<States...>> state_machine)
      : previous_state_(previous_state), state_machine_(state_machine) {}

  std::shared_ptr<const std::variant<States...>> previous_state_;
  std::weak_ptr<const StateMachine<States...>> state_machine_;
};

// Helper to get the index of a type in a parameter pack
template <typename T, typename... Ts>
struct type_index;

template <typename T, typename... Ts>
struct type_index<T, T, Ts...> : std::integral_constant<size_t, 0> {};

template <typename T, typename U, typename... Ts>
struct type_index<T, U, Ts...>
    : std::integral_constant<size_t, 1 + type_index<T, Ts...>::value> {};

template <typename... States>
class StateMachine
    : public std::enable_shared_from_this<StateMachine<States...>> {
 public:
  friend class StateHandle<States...>;
  using State = std::variant<States...>;
  using StateOpt = std::optional<State>;
  using Query = oww::common::StateQuery<States...>;

  template <typename T>
  using LoopFn = std::function<StateOpt(T&)>;

  template <typename InitialState, typename... Args>
  static std::shared_ptr<StateMachine<States...>> Create(
      std::in_place_type_t<InitialState>, Args&&... args) {
    struct MakeSharedEnabler : public StateMachine<States...> {
      MakeSharedEnabler(std::in_place_type_t<InitialState> in_place,
                        Args&&... args)
          : StateMachine(in_place, std::forward<Args>(args)...) {}
    };
    return std::make_shared<MakeSharedEnabler>(std::in_place_type<InitialState>,
                                               std::forward<Args>(args)...);
  }

  template <typename T>
  void OnLoop(LoopFn<T> fn) {
    std::get<LoopFn<T>>(loop_handlers_) = fn;
  }

  StateHandle<States...> Loop() {
    auto handle =
        StateHandle<States...>(current_state_, this->weak_from_this());

    StateOpt new_state = std::visit(
        [this](auto& state) -> StateOpt {
          using StateType = std::decay_t<decltype(state)>;
          auto& handler = std::get<LoopFn<StateType>>(loop_handlers_);
          if (handler) {
            return handler(state);
          }
          return std::nullopt;
        },
        *current_state_);

    if (new_state) {
      current_state_ = std::make_shared<State>(std::move(*new_state));
    }

    return handle;
  }

  const State& GetState() const { return *current_state_; }
  std::shared_ptr<const State> GetStatePtr() const { return current_state_; }

  template <typename T>
  bool Is() const {
    return std::holds_alternative<T>(*current_state_);
  }

  template <typename T>
  const T* Get() const {
    return std::get_if<T>(current_state_.get());
  }

 protected:
  template <typename InitialState, typename... Args>
  StateMachine(std::in_place_type_t<InitialState>, Args&&... args)
      : current_state_(std::make_shared<State>(std::in_place_type<InitialState>,
                                               std::forward<Args>(args)...)) {}

 private:
  std::shared_ptr<State> current_state_;
  std::tuple<LoopFn<States>...> loop_handlers_;
};

}  // namespace oww::common
