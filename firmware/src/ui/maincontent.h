#pragma once

#include <memory>

#include "buttonbar.h"
#include "component.h"

namespace oww::ui {

// Forward declaration to avoid circular dependency
class UserInterface;

class MainContent : public Component {
 public:
  MainContent(lv_obj_t* parent, std::shared_ptr<oww::logic::Application> state,
              UserInterface* ui);
  virtual ~MainContent();

  virtual void Render() override;

  /** Called when this content becomes active */
  virtual void OnActivate();

  /** Called when this content becomes inactive */
  virtual void OnDeactivate();

  /** Returns the button definition for this content, or nullptr if none */
  virtual std::shared_ptr<ButtonDefinition> GetButtonDefinition() {
    return nullptr;
  }

 protected:
  /** Push a new MainContent onto the stack, making it active */
  void PushContent(std::shared_ptr<MainContent> content);

  /** Pop the current MainContent from the stack, returning to the previous one
   */
  void PopContent();

 private:
  UserInterface* ui_;
};

}  // namespace oww::ui
